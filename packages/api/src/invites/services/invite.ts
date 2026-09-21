import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpForbiddenError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import {
  type BillingInvite,
  BillingRecurrence,
  type BillingSplit,
  BillingState,
  ChargeState,
  type InviteAcceptResult,
  planBillingCharges,
  type PublicInviteView,
  resolveBillingSplit,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { SettledLockedError } from '../../billings/errors';
import { BillingRepository } from '../../billings/repositories/billing';
import { BillingGuestRepository } from '../../billings/repositories/guest';
import { BillingGuestState } from '../../billings/schemas/billing-guest';
import { auditBilling, saveAllocations, splitFor } from '../../billings/services/split';
import { billingKind, billingRecurrence, billingRegistered } from '../../billings/utils/columns';
import { ChargeRepository } from '../../charges/repositories/charge';
import { persistChargePlan, prepareChargeMaterialization } from '../../charges/services/materialize';
import { debtorOf } from '../../charges/utils/columns';
import type { EmailService } from '../../common/services/email/service';
import { INVITE_ACCEPT, throttlePublicRead } from '../../common/utils/throttle';
import { ensure } from '../../contacts/services/contact';
import type { Db, DbClient } from '../../database';
import type { ChargeNotifyScheduler } from '../../notifications/schedulers/charge-notify';
import { noticeContext } from '../../notifications/services/context';
import { pushToUser } from '../../notifications/services/direct';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { ProofRepository } from '../../proofs/repositories/proof';
import { LinkRepository } from '../../public/repositories/link';
import { AccountRepository } from '../../users/repositories/account';
import { InviteOwnerError, SplitClosedError, SplitInProgressError } from '../errors';
import { createInvite, publicInviteView, resolveInvite, revokeInvite } from './links';

export type InviteClient = {
  create(ownerId: string, billingId: string): Promise<BillingInvite>;
  revoke(ownerId: string, billingId: string): Promise<void>;
  preview(token: string): Promise<PublicInviteView>;
  accept(userId: string, token: string): Promise<InviteAcceptResult>;
};

export declare class InviteService extends Factory.Service<InviteClient> {
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

export type Accepted = InviteAcceptResult & {
  /** Set when the guest is parked for the owner: who to tell and what the billing is called. */
  waiting?: { ownerId: string; description: string; guestName: string };
};

/** The guest always joins at the end of the order, with one quota when the split is weighted. */
function withParticipant(split: BillingSplit, userId: string): BillingSplit {
  if (split.mode === SplitMode.Shares) {
    return { mode: SplitMode.Shares, parts: [...split.parts, { kind: SplitPartKind.User, userId, shares: 1 }] };
  }

  if (split.mode === SplitMode.Equal) {
    return { mode: SplitMode.Equal, parts: [...split.parts, { kind: SplitPartKind.User, userId }] };
  }

  throw new SplitClosedError();
}

/** Every charge of a finite billing must still be untouched before its amounts can be reshaped. */
async function assertSplitReshapable(db: DbClient, charges: ChargeRepository.Row[]): Promise<void> {
  const proofs = await ProofRepository.byCharges(
    db,
    charges.map((charge) => charge.id)
  );

  for (const charge of charges) {
    if (charge.state !== ChargeState.Pending) {
      throw new SplitInProgressError();
    }

    if (proofs.has(charge.id)) {
      throw new SplitInProgressError();
    }
  }
}

async function reshapeOccurrences(
  db: DbClient,
  billing: BillingRepository.Row,
  charges: ChargeRepository.Row[],
  split: BillingSplit,
  userId: string,
  now: string,
  due: string[]
): Promise<string | null> {
  const resolved = new Map(
    resolveBillingSplit(billing.total_cents, split).flatMap((allocation) =>
      allocation.kind === SplitPartKind.User ? [[allocation.userId, allocation.amountCents] as const] : []
    )
  );
  const occurrences = new Map<string, ChargeRepository.Row[]>();

  for (const charge of charges) {
    const key = `${charge.due_date}|${charge.installment ?? ''}`;

    occurrences.set(key, [...(occurrences.get(key) ?? []), charge]);
  }

  const context = await prepareChargeMaterialization(db, billing.owner_id, [userId], billing.payment_method_id);
  const timezone = await AccountRepository.timezone(db, billing.owner_id);

  let first: string | null = null;

  for (const group of occurrences.values()) {
    for (const charge of group) {
      // Invite acceptance only touches contas a receber, whose charges always name a contact.
      const debtorId = debtorOf(charge);
      const amountCents = debtorId ? resolved.get(debtorId) : undefined;

      // Reshaping must never leave a stale amount behind; the whole acceptance rolls back instead.
      if (amountCents === undefined) {
        throw new Error('Occurrence charge without a resolved allocation.');
      }

      if (amountCents !== charge.amount_cents) {
        await ChargeRepository.setAmount(db, charge.id, amountCents, now);
      }
    }

    const sample = group[0]!;
    const plan = planBillingCharges({
      description: billing.description,
      totalCents: billing.total_cents,
      split,
      dueDates: [sample.due_date],
      numbered: false
    });
    const mine = plan.charges
      .filter((charge) => charge.userId === userId)
      .map((charge) => ({ ...charge, installment: sample.installment ?? null, installmentCount: sample.installment_count ?? null }));

    if (!mine.length) {
      continue;
    }

    const { rows, noticeChargeIds } = await persistChargePlan(
      db,
      billing.owner_id,
      { ...plan, charges: mine },
      { id: billing.id, type: billingRecurrence(billing), kind: billingKind(billing), timezone },
      context,
      now
    );

    due.push(...noticeChargeIds);

    first ??= rows[0]?.id ?? null;
  }

  return first;
}

/** Contacts without e-mail in the split: the owner has to say whether the guest is one of them. */
async function splitHasPlaceholders(db: DbClient, split: BillingSplit): Promise<boolean> {
  const userIds = split.parts.flatMap((part) => (part.kind === SplitPartKind.User ? [part.userId] : []));

  if (!userIds.length) {
    return false;
  }

  return (await AccountRepository.countPlaceholders(db, userIds)) > 0;
}

/**
 * Puts the guest into the split of an active billing, repricing the charges that already exist. Shared by
 * the immediate acceptance and the owner adding a waiting guest later; the caller holds the owner lock.
 */
export async function joinSplit(
  tx: DbClient,
  billing: BillingRepository.Row,
  userId: string,
  instant: string,
  noticeChargeIds: string[]
): Promise<{ chargeId: string | null; joinedSplit: boolean }> {
  const { split } = await splitFor(tx, billing);

  if (split.parts.some((part) => part.kind === SplitPartKind.User && part.userId === userId)) {
    return { chargeId: await ChargeRepository.nearestPending(tx, billing.id, userId), joinedSplit: false };
  }

  // Fixed and percentage splits carry explicit amounts the owner alone can rebalance.
  if (split.mode === SplitMode.Fixed || split.mode === SplitMode.Percentage) {
    return { chargeId: null, joinedSplit: false };
  }

  const next = withParticipant(split, userId);
  const charges = billingRecurrence(billing) === BillingRecurrence.Indefinite ? [] : await ChargeRepository.byBilling(tx, billing.id, { lock: true });

  await assertSplitReshapable(tx, charges);
  await saveAllocations(tx, billing, billing.total_cents, next, instant);

  const chargeId = charges.length ? await reshapeOccurrences(tx, billing, charges, next, userId, instant, noticeChargeIds) : null;

  return { chargeId, joinedSplit: true };
}

/** The guest is not in the split and a placeholder might be them: they wait for the owner's word. */
async function parkGuest(tx: DbClient, billing: BillingRepository.Row, userId: string, instant: string): Promise<boolean> {
  const parked = await BillingGuestRepository.byUser(tx, billing.id, userId);

  if (parked?.state === BillingGuestState.Pending) {
    return false;
  }

  if (parked) {
    await BillingGuestRepository.park(tx, parked.id, instant);
  } else {
    await BillingGuestRepository.insert(tx, { billingId: billing.id, ownerId: billing.owner_id, userId, now: instant });
  }

  return true;
}

export async function acceptInvite(
  db: DbClient,
  userId: string,
  token: string,
  secret: string,
  now = new Date(),
  notice?: NoticeContext
): Promise<Accepted> {
  const preview = await resolveInvite(db, token, secret);
  const noticeChargeIds: string[] = [];

  // A link does not know who owns the target, so the billing comes first and the owner lock follows it.
  const ownerId = await BillingRepository.ownerOf(db, preview.billing_id);

  if (!ownerId) {
    throw new HttpNotFoundError();
  }

  const result = await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const invite = await LinkRepository.byId(tx, preview.id, true);

    if (!invite || invite.revoked_at || new Date(invite.expires_at) <= now) {
      throw new HttpNotFoundError();
    }

    const billing = await BillingRepository.get(tx, ownerId, invite.linkable_id, true);

    if (billing?.state !== BillingState.Active) {
      throw new HttpNotFoundError();
    }

    if (billing.owner_id === userId) {
      throw new InviteOwnerError();
    }

    // An invite made before registros refused them still cannot put anyone into one.
    if (billingRegistered(billing)) {
      throw new SettledLockedError();
    }

    const user = await AccountRepository.get(tx, userId);

    if (!user) {
      throw new HttpUnauthorizedError();
    }

    if (!user.verified_email || user.verified_email !== user.email) {
      throw new HttpForbiddenError('Confirme seu e-mail antes de participar.');
    }

    const instant = now.toISOString();
    const { split } = await splitFor(tx, billing);
    const alreadyIn = split.parts.some((part) => part.kind === SplitPartKind.User && part.userId === userId);

    // Contacts without e-mail may be this very person: the owner decides, so the guest waits outside the split.
    if (!alreadyIn && (await splitHasPlaceholders(tx, split))) {
      const parked = await parkGuest(tx, billing, userId, instant);

      if (!parked) {
        return { billingId: billing.id, chargeId: null, joinedSplit: false, awaitingOwner: true };
      }

      await LinkRepository.setAcceptedCount(tx, invite.id, (invite.accepted_count ?? 0) + 1);
      await auditBilling(tx, billing.owner_id, billing.id, 'billings.guest_waiting', instant, { userId });

      return {
        billingId: billing.id,
        chargeId: null,
        joinedSplit: false,
        awaitingOwner: true,
        waiting: { ownerId: billing.owner_id, description: billing.description, guestName: user.name?.trim() || user.email || 'Alguém' }
      };
    }

    // The guest is the account itself: the agenda entry is all the owner needs.
    await ensure(tx, billing.owner_id, userId, instant);

    if (alreadyIn) {
      return {
        billingId: billing.id,
        chargeId: await ChargeRepository.nearestPending(tx, billing.id, userId),
        joinedSplit: false,
        awaitingOwner: false
      };
    }

    const { chargeId, joinedSplit } = await joinSplit(tx, billing, userId, instant, noticeChargeIds);

    await LinkRepository.setAcceptedCount(tx, invite.id, (invite.accepted_count ?? 0) + 1);
    await auditBilling(tx, billing.owner_id, billing.id, 'billings.invite_accepted', instant, { userId, joinedSplit });

    return { billingId: billing.id, chargeId, joinedSplit, awaitingOwner: false };
  });

  // The acceptance is committed before the guest hears about their new charge.
  if (notice) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  return result;
}

export function createService({ db, email, variables }: Service.Context<InviteService>): InviteClient {
  const secret = variables.PUBLIC_LINK_HMAC_SECRET;
  const origin = variables.PUBLIC_WEB_ORIGIN;

  return {
    create: (ownerId, billingId) => createInvite(db, ownerId, billingId, secret, origin),
    revoke: (ownerId, billingId) => revokeInvite(db, ownerId, billingId),
    preview: async (token) => {
      const invite = await resolveInvite(db, token, secret);

      await throttlePublicRead(db, invite.public_id);

      return publicInviteView(db, invite);
    },
    accept: async (userId, token) => {
      const invite = await resolveInvite(db, token, secret);

      await throttlePublicRead(db, invite.public_id, INVITE_ACCEPT);

      const notice = noticeContext({ email, variables });
      const { waiting, ...result } = await acceptInvite(db, userId, token, secret, new Date(), notice);

      // The owner learns right away that someone is waiting; the card on the billing detail is the fallback.
      if (waiting) {
        await pushToUser(db, notice.transport, waiting.ownerId, {
          title: `Alguém entrou em «${waiting.description}»`,
          body: `${waiting.guestName} entrou pelo link. Diga quem é para liberar a cobrança.`,
          url: `${origin}/billings/${result.billingId}`
        });
      }

      return result;
    }
  };
}
