import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { ChargeState, Direction, PaymentLinkState, type PublicChargeView, type PublicLink } from '@receivy/common';
import { ChargeClosedError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { chargeForActor } from '../../charges/services/access';
import { checkoutClients, ensurePaymentLink, paymentLinkConfigFrom } from '../../charges/services/payment-link';
import { creditorOf, ownerPays, paymentLinkOf, paymentOf, snapshotDto } from '../../charges/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { EmailService } from '../../common/services/email/service';
import { throttlePublicRead } from '../../common/utils/throttle';
import type { Db, DbClient } from '../../database';
import type { ChargeNotifyScheduler } from '../../notifications/schedulers/charge-notify';
import { noticeContext } from '../../notifications/services/context';
import { announceCharges, type NoticeContext, NoticeTemplate } from '../../notifications/services/send';
import { PaymentMethodRepository } from '../../payment-methods/repositories/payment-method';
import { ProofRepository } from '../../proofs/repositories/proof';
import { AccountRepository } from '../../users/repositories/account';
import { PixRequiredError, PixSnapshotLockedError } from '../errors';
import { LinkRepository, type LinkRow } from '../repositories/link';
import { LinkableType } from '../schemas/link';
import { assertPublicLinkSecretConfigured, PublicTokenPurpose, verifyPublicChargeToken } from './capability';
import { ensurePublicLink, linkToken } from './links';

export type PublicLinkClient = {
  /**
   * Issues (or reuses) the public payment link of a charge. Publishing a Pix key on a charge created
   * without one happens here too, and sends the initial notice that had nothing to say until now.
   */
  publish(creditorId: string, chargeId: string, paymentMethodId?: string): Promise<PublicLink>;
  /** A fresh link; the old one stops working. */
  rotate(creditorId: string, chargeId: string): Promise<PublicLink>;
  /** The charge behind a public token, as the page shows it; 404 for anything forged, rotated, revoked or expired. */
  view(token: string): Promise<{ charge: ChargeRepository.Row; view: PublicChargeView }>;
};

export declare class PublicLinkService extends Factory.Service<PublicLinkClient> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PAYMENT_METHOD_LINK: Environment.VariableOrValue<'PAYMENT_METHOD_LINK', 'disabled'>;
    PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };

  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    chargeNotifyScheduler: Environment.Service<ChargeNotifyScheduler>;
    variables: Environment.ServiceVariables;
  };
}

function response(link: LinkRow, secret: string): PublicLink {
  return { token: linkToken(link, secret), expiresAt: link.expires_at };
}

/** The owner's own live key a conta a receber may publish; never one kept about a contact, never an archived one. */
async function ownMethod(tx: DbClient, ownerId: string, paymentMethodId: string, lock: boolean) {
  const key = await PaymentMethodRepository.pointer(tx, ownerId, paymentMethodId, true, lock);

  if (!key || key.archivedAt) {
    throw new HttpNotFoundError();
  }

  return key;
}

export async function publishChargeLink(
  db: DbClient,
  creditorId: string,
  chargeId: string,
  secret: string,
  rotate = false,
  nowSeconds = Math.floor(Date.now() / 1000),
  paymentMethodId?: string,
  notice?: NoticeContext
): Promise<PublicLink> {
  assertPublicLinkSecretConfigured(secret);

  const { link, announce } = await db.transaction(async (tx) => {
    const { row, direction } = await chargeForActor(tx, creditorId, chargeId, true);

    // A conta a pagar never gets a public link: the owner pays with the key they typed.
    if (direction !== Direction.Receivable || ownerPays(row)) {
      throw new HttpForbiddenError();
    }

    if (row.state !== ChargeState.Pending) {
      throw new ChargeClosedError();
    }

    let published = false;
    // A charge published once without a key stays refused even after that link was revoked.
    const everPublished = await LinkRepository.everIssued(tx, LinkableType.Charge, row.id);
    const payment = paymentOf(row);

    if (!payment) {
      if (everPublished || !paymentMethodId) {
        throw new PixRequiredError();
      }

      const method = await ownMethod(tx, creditorId, paymentMethodId, true);
      const stamp = new Date(nowSeconds * 1000).toISOString();

      await ChargeRepository.setPayment(
        tx,
        row.id,
        {
          provider: method.provider,
          ...(method.kind ? { kind: method.kind } : {}),
          value: method.value,
          label: method.label,
          ...(method.integrationId ? { integrationId: method.integrationId } : {})
        },
        stamp
      );
      await EventRepository.record(tx, { type: 'charge.pix_published', eventableType: EventableType.Charge, eventableId: row.id, actorId: creditorId, at: stamp });

      // The creation notice was skipped for lack of a key; it goes out once the link exists.
      published = !(await EventRepository.list(tx, row.id, 'notice.sent')).some((event) => event.payload.template === NoticeTemplate.Initial);
    } else if (paymentMethodId) {
      const method = await ownMethod(tx, creditorId, paymentMethodId, false);

      if (method.value !== payment.value || method.provider !== payment.provider) {
        throw new PixSnapshotLockedError();
      }
    }

    const linked = await ensurePublicLink(tx, row.id, nowSeconds, rotate);

    return { link: response(linked, secret), announce: published };
  });

  if (announce && notice) {
    await announceCharges(db, notice, [chargeId], nowSeconds * 1000);
  }

  return link;
}

export async function revokeChargeLink(db: DbClient, creditorId: string, chargeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { row, direction } = await chargeForActor(tx, creditorId, chargeId, true);

    if (direction !== Direction.Receivable || ownerPays(row)) {
      throw new HttpForbiddenError();
    }

    if (!(await LinkRepository.live(tx, LinkableType.Charge, row.id))) {
      return;
    }

    const stamp = new Date().toISOString();

    await LinkRepository.revokeLive(tx, LinkableType.Charge, row.id, stamp);
    await ChargeRepository.touch(tx, row.id, stamp);
  });
}

/** What the public payment page may know about a charge. */
export async function publicChargeView(db: DbClient, charge: ChargeRepository.Row): Promise<PublicChargeView> {
  const creditorId = creditorOf(charge);
  const creditor = creditorId ? await AccountRepository.person(db, creditorId) : null;
  const firstName = creditor?.name?.trim().split(/\s+/)[0] || 'Pessoa';
  const payment = paymentOf(charge);

  return {
    creditorFirstName: firstName,
    description: charge.description,
    amount: { amountCents: charge.amount_cents, currency: 'BRL' },
    dueDate: charge.due_date,
    state: charge.state,
    payment: snapshotDto(payment),
    paymentLink: paymentLinkOf(charge),
    receiptUrl: charge.provider_receipt_url ?? null,
    uploadsEnabled: charge.state === ChargeState.Pending && (await ProofRepository.current(db, charge.id))?.state !== StoredProofState.Pending
  };
}

/** The charge behind a public token, or 404 for anything forged, rotated, revoked or expired. */
export async function resolvePublicCharge(
  db: DbClient,
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<ChargeRepository.Row> {
  assertPublicLinkSecretConfigured(secret);

  const publicId = token.split('.')[0];

  if (!publicId) {
    throw new HttpNotFoundError();
  }

  const link = await LinkRepository.byPublicId(db, publicId);

  if (!link || link.linkable_type !== LinkableType.Charge || link.revoked_at) {
    throw new HttpNotFoundError();
  }

  let capability: { publicId: string; expiresAtSeconds: number };

  try {
    capability = verifyPublicChargeToken(token, { nowSeconds, secret, purpose: PublicTokenPurpose.Charge });
  } catch {
    throw new HttpNotFoundError();
  }

  const storedExpiry = Math.floor(Date.parse(link.expires_at) / 1000);

  if (capability.expiresAtSeconds !== storedExpiry || storedExpiry <= nowSeconds) {
    throw new HttpNotFoundError();
  }

  const charge = await ChargeRepository.get(db, link.linkable_id);

  if (!charge) {
    throw new HttpNotFoundError();
  }

  return charge;
}

export async function publicChargeByToken(db: DbClient, token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<PublicChargeView> {
  return publicChargeView(db, await resolvePublicCharge(db, token, secret, nowSeconds));
}

export function createService({ db, email, chargeNotifyScheduler, variables }: Service.Context<PublicLinkService>): PublicLinkClient {
  const secret = variables.PUBLIC_LINK_HMAC_SECRET;
  const links = checkoutClients(variables);
  const linkConfig = paymentLinkConfigFrom(variables);

  return {
    publish: (creditorId, chargeId, paymentMethodId) =>
      publishChargeLink(db, creditorId, chargeId, secret, false, undefined, paymentMethodId, noticeContext({ chargeNotifyScheduler, email, variables })),
    rotate: (creditorId, chargeId) => publishChargeLink(db, creditorId, chargeId, secret, true),
    view: async (token) => {
      const charge = await resolvePublicCharge(db, token, secret);

      await throttlePublicRead(db, charge.id);

      const link = paymentLinkOf(charge);

      // Last resort for a link that failed at creation and at notice time: the payer is here now. A Pix charge has no link to chase.
      if (link && link.state !== PaymentLinkState.Ready && (await ensurePaymentLink(db, links, linkConfig, charge.id)) === PaymentLinkState.Ready) {
        return { charge, view: await publicChargeView(db, (await ChargeRepository.get(db, charge.id))!) };
      }

      return { charge, view: await publicChargeView(db, charge) };
    }
  };
}
