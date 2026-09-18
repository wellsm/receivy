import { ChargeState, PaymentLinkState, PaymentProvider } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { pushToUser } from '../../notifications/services/direct';
import type { NotificationTransport } from '../../notifications/services/transport';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../public/services/capability';
import { ensurePublicLink, linkToken } from '../../public/services/links';
import { createInfinitePayClient } from '../../vendors/infinitepay/client';
import { createFakePaymentLinkProvider } from '../../vendors/infinitepay/fake';
import type { PaymentLinkProvider, PaymentLinkResult } from '../../vendors/infinitepay/types';
import { ChargeRepository } from '../repositories/charge';
import { ownerOf, paymentOf } from '../utils/columns';

export const enum PaymentLinkMode {
  Live = 'live',
  Fake = 'fake',
  Disabled = 'disabled'
}

/** Nothing configured: every link and every check answers unavailable. */
const disabledProvider: PaymentLinkProvider = {
  createLink: async () => ({ status: 'unavailable' }),
  checkPayment: async () => ({ status: 'unavailable' })
};

/** `PAYMENT_METHOD_LINK` picks the client: `live` talks to InfinitePay, `fake` answers in-process (local, tests), anything else is off. */
export function paymentLinkProvider(env: { PAYMENT_METHOD_LINK?: string; PUBLIC_WEB_ORIGIN?: string }, request: typeof fetch = globalThis.fetch): PaymentLinkProvider {
  if (env.PAYMENT_METHOD_LINK === PaymentLinkMode.Live) {
    return createInfinitePayClient(request);
  }

  if (env.PAYMENT_METHOD_LINK === PaymentLinkMode.Fake) {
    return createFakePaymentLinkProvider(env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000');
  }

  return disabledProvider;
}

export type PaymentLinkConfig = { apiOrigin: string; webOrigin: string; secret: string };

export type PaymentLinkVariables = { PUBLIC_API_ORIGIN?: string; PUBLIC_WEB_ORIGIN: string; PUBLIC_LINK_HMAC_SECRET: string; PAYMENT_METHOD_LINK?: string };

export const WEBHOOK_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export function paymentLinkConfigFrom(variables: PaymentLinkVariables): PaymentLinkConfig {
  return {
    apiOrigin: (variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, ''),
    webOrigin: variables.PUBLIC_WEB_ORIGIN.replace(/\/+$/, ''),
    secret: variables.PUBLIC_LINK_HMAC_SECRET
  };
}

/** The webhook path segment: unguessable, bound to the charge, never a proof of payment on its own. */
export function webhookToken(chargeId: string, secret: string, nowSeconds: number): string {
  return issuePublicChargeToken({ publicId: chargeId, expiresAtSeconds: nowSeconds + WEBHOOK_TOKEN_TTL_SECONDS, secret, purpose: PublicTokenPurpose.ProviderWebhook });
}

function record(db: DbClient, chargeId: string, type: string, payload: Record<string, unknown>, at: string) {
  return EventRepository.record(db, { type, eventableType: EventableType.Charge, eventableId: chargeId, payload, at });
}

/**
 * Makes sure an InfinitePay charge has its checkout link. Safe to call from anywhere, any number of times:
 * a Pix charge, a settled charge or a link already ready are no-ops. A failure is written down as `failed`
 * so the next caller (the notice, the public page, the owner's button) tries again. A provider failure or a
 * token that cannot be minted never throws: it is written down as `failed`. A database error propagates
 * like any repository call.
 */
export async function ensurePaymentLink(
  db: DbClient,
  links: PaymentLinkProvider,
  config: PaymentLinkConfig,
  chargeId: string,
  now = Date.now(),
  transport?: NotificationTransport
): Promise<PaymentLinkState | null> {
  const charge = await ChargeRepository.get(db, chargeId);
  const payment = charge ? paymentOf(charge) : null;

  if (!charge || payment?.provider !== PaymentProvider.InfinitePay) {
    return null;
  }

  const current = charge.payment_link_state ?? PaymentLinkState.Pending;

  if (current === PaymentLinkState.Ready || charge.state !== ChargeState.Pending) {
    return current;
  }

  const nowSeconds = Math.floor(now / 1000);
  const stamp = new Date(now).toISOString();
  const publicLink = await ensurePublicLink(db, charge.id, nowSeconds);

  let result: PaymentLinkResult;

  try {
    result = await links.createLink({
      handle: payment.value,
      orderNsu: charge.id,
      items: [{ quantity: 1, price: charge.amount_cents, description: charge.description }],
      webhookUrl: `${config.apiOrigin}/webhooks/infinitepay/${webhookToken(charge.id, config.secret, nowSeconds)}`,
      redirectUrl: `${config.webOrigin}/pay/${linkToken(publicLink, config.secret)}`
    });
  } catch (error) {
    console.error('Payment link creation failed', { chargeId: charge.id, error: error instanceof Error ? error.message : 'unknown' });

    result = { status: 'unavailable' };
  }

  if (result.status === 'created') {
    await ChargeRepository.setPaymentLink(db, charge.id, { url: result.url, state: PaymentLinkState.Ready }, stamp);
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

  await record(db, charge.id, 'charge.payment_link.failed', { reason: 'unavailable' }, stamp);

  return PaymentLinkState.Failed;
}
