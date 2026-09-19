import { ChargeState, PaymentLinkState, PaymentProvider } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { credentialOf } from '../../integrations/utils/credential';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../public/services/capability';
import { ensurePublicLink, linkToken } from '../../public/services/links';
import { fakeCheckout } from '../../vendors/checkout/fake';
import { infinitePayCheckout } from '../../vendors/checkout/infinitepay';
import { pagSeguroCheckout } from '../../vendors/checkout/pagseguro';
import type { CheckoutClient, CheckoutClients, CheckoutLinkResult, CheckoutProvider } from '../../vendors/checkout/types';
import { createInfinitePayClient } from '../../vendors/infinitepay/client';
import { createPagSeguroClient } from '../../vendors/pagseguro/client';
import { PagSeguroHost } from '../../vendors/pagseguro/types';
import { ChargeRepository } from '../repositories/charge';
import { ownerOf, paymentOf } from '../utils/columns';

export const enum PaymentLinkMode {
  Live = 'live',
  Sandbox = 'sandbox',
  Fake = 'fake',
  Disabled = 'disabled'
}

/** Nothing configured: every call answers unavailable. */
const disabledClient: CheckoutClient = {
  createLink: async () => ({ status: 'unavailable' }),
  checkPayment: async () => ({ status: 'unavailable' }),
  inactivate: async () => ({ status: 'unavailable' }),
  verifyCredential: async () => ({ status: 'unavailable' })
};

/**
 * `PAYMENT_METHOD_LINK` picks the clients: `live` talks to the providers, `sandbox` too but PagBank on its sandbox host
 * (InfinitePay has none), `fake` answers in-process, anything else is off.
 */
export function checkoutClients(env: { PAYMENT_METHOD_LINK?: string; PUBLIC_WEB_ORIGIN?: string }, request: typeof fetch = globalThis.fetch): CheckoutClients {
  const mode = env.PAYMENT_METHOD_LINK;

  if (mode === PaymentLinkMode.Live || mode === PaymentLinkMode.Sandbox) {
    return {
      [PaymentProvider.InfinitePay]: infinitePayCheckout(createInfinitePayClient(request)),
      [PaymentProvider.PagSeguro]: pagSeguroCheckout(createPagSeguroClient(mode === PaymentLinkMode.Sandbox ? PagSeguroHost.Sandbox : PagSeguroHost.Live, request))
    };
  }

  if (mode === PaymentLinkMode.Fake) {
    const origin = env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000';

    return { [PaymentProvider.InfinitePay]: fakeCheckout(origin, PaymentProvider.InfinitePay), [PaymentProvider.PagSeguro]: fakeCheckout(origin, PaymentProvider.PagSeguro) };
  }

  return { [PaymentProvider.InfinitePay]: disabledClient, [PaymentProvider.PagSeguro]: disabledClient };
}

export type PaymentLinkConfig = { apiOrigin: string; webOrigin: string; secret: string; credentialKeyB64: string };

export type PaymentLinkVariables = {
  PUBLIC_API_ORIGIN?: string;
  PUBLIC_WEB_ORIGIN: string;
  PUBLIC_LINK_HMAC_SECRET: string;
  PAYMENT_METHOD_LINK?: string;
  PAYMENT_CREDENTIAL_KEY_B64?: string;
};

export const WEBHOOK_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export function paymentLinkConfigFrom(variables: PaymentLinkVariables): PaymentLinkConfig {
  return {
    apiOrigin: (variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, ''),
    webOrigin: variables.PUBLIC_WEB_ORIGIN.replace(/\/+$/, ''),
    secret: variables.PUBLIC_LINK_HMAC_SECRET,
    credentialKeyB64: variables.PAYMENT_CREDENTIAL_KEY_B64 ?? 'disabled'
  };
}

/** Providers with a checkout link; a Pix snapshot has none. */
export function checkoutProviderOf(provider: PaymentProvider): CheckoutProvider | null {
  if (provider === PaymentProvider.InfinitePay || provider === PaymentProvider.PagSeguro) {
    return provider;
  }

  return null;
}

/** The webhook path segment: unguessable, bound to the charge, never a proof of payment on its own. */
export function webhookToken(chargeId: string, secret: string, nowSeconds: number): string {
  return issuePublicChargeToken({ publicId: chargeId, expiresAtSeconds: nowSeconds + WEBHOOK_TOKEN_TTL_SECONDS, secret, purpose: PublicTokenPurpose.ProviderWebhook });
}

function record(db: DbClient, chargeId: string, type: string, payload: Record<string, unknown>, at: string) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, payload, at });
}

/**
 * Makes sure a checkout charge has its link. Safe to call from anywhere, any number of times: a Pix charge,
 * a settled charge or a link already ready are no-ops. A failure is written down as `failed` so the next
 * caller (the notice, the public page, the owner's button) tries again. A provider failure or a token that
 * cannot be minted never throws: it is written down as `failed`. A database error propagates like any
 * repository call.
 */
export async function ensurePaymentLink(
  db: DbClient,
  clients: CheckoutClients,
  config: PaymentLinkConfig,
  chargeId: string,
  now = Date.now(),
  transport?: NotificationTransport
): Promise<PaymentLinkState | null> {
  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;
  const provider = payment ? checkoutProviderOf(payment.provider) : null;

  if (!charge || !payment || !provider) {
    return null;
  }

  const current = charge.payment_link_state ?? PaymentLinkState.Pending;

  if (current === PaymentLinkState.Ready || charge.state !== ChargeState.Pending) {
    return current;
  }

  const stamp = new Date(now).toISOString();

  let credential: string | undefined;

  if (provider === PaymentProvider.PagSeguro) {
    const lookup = payment.integrationId ? await credentialOf(db, config.credentialKeyB64, payment.integrationId) : { status: 'missing' as const };

    if (lookup.status !== 'ok') {
      await ChargeRepository.setPaymentLink(db, charge.id, { state: PaymentLinkState.Failed }, stamp);
      await record(db, charge.id, 'charge.payment_link.failed', { reason: 'no_credential', detail: lookup.status }, stamp);

      return PaymentLinkState.Failed;
    }

    credential = lookup.secret;
  }

  const nowSeconds = Math.floor(now / 1000);
  const publicLink = await ensurePublicLink(db, charge.id, nowSeconds);

  let result: CheckoutLinkResult;

  try {
    result = await clients[provider].createLink({
      orderNsu: charge.id,
      amountCents: charge.amount_cents,
      description: charge.description,
      webhookUrl: `${config.apiOrigin}/webhooks/${provider}/${webhookToken(charge.id, config.secret, nowSeconds)}`,
      // PagBank returns to `redirectUrl` as given, without ids: the web page detects a return via `?returned=1`.
      redirectUrl: `${config.webOrigin}/pay/${linkToken(publicLink, config.secret)}${provider === PaymentProvider.PagSeguro ? '?returned=1' : ''}`,
      expiresAt: publicLink.expires_at,
      identity: payment.value,
      credential
    });
  } catch (error) {
    console.error('Payment link creation failed', { chargeId: charge.id, error: error instanceof Error ? error.message : 'unknown' });

    result = { status: 'unavailable' };
  }

  if (result.status === 'created') {
    await ChargeRepository.setPaymentLink(db, charge.id, { url: result.url, linkId: result.linkId, state: PaymentLinkState.Ready }, stamp);
    await record(db, charge.id, 'charge.payment_link.created', { url: result.url }, stamp);

    return PaymentLinkState.Ready;
  }

  await ChargeRepository.setPaymentLink(db, charge.id, { state: PaymentLinkState.Failed }, stamp);

  if (result.status === 'checkout_disabled') {
    await record(db, charge.id, 'charge.payment_link.failed', { reason: 'checkout_disabled', redirectUrl: result.redirectUrl }, stamp);

    // Already failed once: the owner heard about it on the first try, a retry never pushes again.
    if (transport && current !== PaymentLinkState.Failed) {
      await pushToUser(db, transport, ownerOf(charge), {
        title: 'Link de pagamento não criado',
        body: 'Ative o checkout externo no app da InfinitePay para a cobrança ganhar um link.',
        url: `${config.webOrigin}/charges/${charge.id}`
      });
    }

    return PaymentLinkState.Failed;
  }

  // The provider refused the credential itself: the owner has to fix the token before any link exists.
  if (result.status === 'unauthorized') {
    await record(db, charge.id, 'charge.payment_link.failed', { reason: 'unauthorized' }, stamp);

    // Already failed once: the owner heard about it on the first try, a retry never pushes again.
    if (transport && current !== PaymentLinkState.Failed) {
      await pushToUser(db, transport, ownerOf(charge), {
        title: 'Token do PagBank inválido',
        body: 'Reconecte sua conta PagBank em Meios de pagamento para a cobrança ganhar um link.',
        url: `${config.webOrigin}/settings/payment-methods`
      });
    }

    return PaymentLinkState.Failed;
  }

  await record(db, charge.id, 'charge.payment_link.failed', { reason: 'unavailable' }, stamp);

  return PaymentLinkState.Failed;
}

/** Best-effort after a cancel: a PagBank checkout that is still open is switched off so nobody pays a dead charge. */
export async function inactivatePaymentLink(db: DbClient, clients: CheckoutClients, config: PaymentLinkConfig, chargeId: string, now = Date.now()): Promise<void> {
  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;
  const provider = payment ? checkoutProviderOf(payment.provider) : null;

  if (!charge || !provider || !charge.provider_link_id || charge.payment_link_state !== PaymentLinkState.Ready) {
    return;
  }

  const stamp = new Date(now).toISOString();
  const lookup = payment?.integrationId ? await credentialOf(db, config.credentialKeyB64, payment.integrationId) : null;
  const result = await clients[provider].inactivate({ credential: lookup?.status === 'ok' ? lookup.secret : undefined, linkId: charge.provider_link_id });

  if (result.status === 'done') {
    await record(db, charge.id, 'charge.payment_link.inactivated', { linkId: charge.provider_link_id }, stamp);

    return;
  }

  if (result.status !== 'unsupported') {
    await record(db, charge.id, 'charge.payment_link.inactivate_failed', { linkId: charge.provider_link_id, reason: result.status }, stamp);
  }
}
