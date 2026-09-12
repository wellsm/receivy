import { Order } from '@ez4/database';
import { HttpForbiddenError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import { type BillingSplit, type InviteAcceptResult, planBillingCharges, resolveBillingSplit } from '@receivy/common';
import { audit, BILLING_SELECT, type BillingRow, saveAllocations, splitFor } from '../../billings/repositories/billing';
import { CHARGE_SELECT, type ChargeRow } from '../../charges/repositories/charge';
import { lockOwner, persistChargePlan, prepareChargeMaterialization } from '../../charges/services/materialize';
import { ensureContact } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { InviteOwnerError, SplitClosedError, SplitInProgressError } from '../errors';
import { INVITE_SELECT, resolveInvite } from '../services/links';

export {
  activeInvite,
  createInvite,
  getPublicInvite,
  type InviteLinkContext,
  revokeInvite
} from '../services/links';

const sqlNull = null as unknown as undefined;

async function nearestPendingCharge(db: DbClient, billingId: string, userId: string): Promise<string | null> {
  const { records } = await db.charges.findMany({
    select: { id: true },
    where: { billing_id: billingId, debtor_user_id: userId, state: 'pending' },
    order: { due_date: Order.Asc },
    take: 1
  });

  return records[0]?.id ?? null;
}

/** The guest always joins at the end of the order, with one quota when the split is weighted. */
function withParticipant(split: BillingSplit, userId: string): BillingSplit {
  if (split.mode === 'shares') {
    return { mode: 'shares', parts: [...split.parts, { kind: 'user', userId, shares: 1 }] };
  }

  if (split.mode === 'equal') {
    return { mode: 'equal', parts: [...split.parts, { kind: 'user', userId }] };
  }

  throw new SplitClosedError();
}

/** Every charge of a finite billing must still be untouched before its amounts can be reshaped. */
function assertSplitReshapable(charges: ChargeRow[]): void {
  for (const charge of charges) {
    if (charge.state !== 'pending') {
      throw new SplitInProgressError();
    }

    if (charge.proof_state) {
      throw new SplitInProgressError();
    }
  }
}

async function reshapeOccurrences(
  db: DbClient,
  billing: BillingRow,
  charges: ChargeRow[],
  split: BillingSplit,
  userId: string,
  now: string,
  due: string[]
): Promise<string | null> {
  const resolved = new Map(
    resolveBillingSplit(billing.total_cents, split).flatMap((allocation) =>
      allocation.kind === 'user' ? [[allocation.userId, allocation.amountCents] as const] : []
    )
  );
  const occurrences = new Map<string, ChargeRow[]>();

  for (const charge of charges) {
    const key = `${charge.due_date}|${charge.installment ?? ''}`;

    occurrences.set(key, [...(occurrences.get(key) ?? []), charge]);
  }

  const context = await prepareChargeMaterialization(db, billing.owner_id, [userId], billing.payment_method_id);

  let first: string | null = null;

  for (const group of occurrences.values()) {
    for (const charge of group) {
      // Invite acceptance only touches contas a receber, whose charges always name a contact.
      const amountCents = charge.debtor_user_id ? resolved.get(charge.debtor_user_id) : undefined;

      // Reshaping must never leave a stale amount behind; the whole acceptance rolls back instead.
      if (amountCents === undefined) {
        throw new Error('Occurrence charge without a resolved allocation.');
      }

      if (amountCents !== charge.amount_cents) {
        await db.charges.updateOne({ where: { id: charge.id }, data: { amount_cents: amountCents, updated_at: now } });
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
      .map((charge) => ({
        ...charge,
        installment: sample.installment ?? null,
        installmentCount: sample.installment_count ?? null
      }));

    if (!mine.length) {
      continue;
    }

    const { rows, noticeChargeIds } = await persistChargePlan(
      db,
      billing.owner_id,
      { ...plan, charges: mine },
      { id: billing.id, type: billing.type },
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
  const userIds = split.parts.flatMap((part) => (part.kind === 'user' ? [part.userId] : []));

  if (!userIds.length) {
    return false;
  }

  const [row] = await db.rawQuery(
    `SELECT COUNT(*) AS total FROM users WHERE id = ANY(string_to_array(:ids::text, ',')::uuid[]) AND email IS NULL AND status = 'pending'`,
    { ids: userIds.join(',') }
  );

  return Number(row?.['total'] ?? 0) > 0;
}

/**
 * Puts the guest into the split of an active billing, repricing the charges that already exist. Shared by
 * the immediate acceptance and the owner adding a waiting guest later; the caller holds the owner lock.
 */
export async function joinSplit(
  tx: DbClient,
  billing: BillingRow,
  userId: string,
  instant: string,
  noticeChargeIds: string[]
): Promise<{ chargeId: string | null; joinedSplit: boolean }> {
  const { split } = await splitFor(tx, billing.id);

  if (split.parts.some((part) => part.kind === 'user' && part.userId === userId)) {
    return { chargeId: await nearestPendingCharge(tx, billing.id, userId), joinedSplit: false };
  }

  // Fixed and percentage splits carry explicit amounts the owner alone can rebalance.
  if (split.mode === 'fixed' || split.mode === 'percentage') {
    return { chargeId: null, joinedSplit: false };
  }

  const next = withParticipant(split, userId);
  const charges =
    billing.type === 'indefinite'
      ? []
      : (
          await tx.charges.findMany({
            select: CHARGE_SELECT,
            where: { billing_id: billing.id },
            order: { due_date: Order.Asc, installment: Order.Asc },
            lock: true
          })
        ).records;

  assertSplitReshapable(charges);
  await saveAllocations(tx, billing.id, billing.total_cents, next, instant);

  const chargeId = charges.length ? await reshapeOccurrences(tx, billing, charges, next, userId, instant, noticeChargeIds) : null;

  return { chargeId, joinedSplit: true };
}

export type AcceptedInvite = InviteAcceptResult & {
  /** Set when the guest is parked for the owner: who to tell and what the billing is called. */
  waiting?: { ownerId: string; description: string; guestName: string };
};

export async function acceptInvite(
  db: DbClient,
  userId: string,
  token: string,
  secret: string,
  now = new Date(),
  notice?: NoticeContext
): Promise<AcceptedInvite> {
  const preview = await resolveInvite(db, token, secret);
  const noticeChargeIds: string[] = [];

  const result = await db.transaction(async (tx) => {
    await lockOwner(tx, preview.owner_id);

    const invite = await tx.billing_invites.findOne({ select: INVITE_SELECT, where: { id: preview.id }, lock: true });

    if (!invite || invite.revoked_at || new Date(invite.expires_at) <= now) {
      throw new HttpNotFoundError();
    }

    if (invite.owner_id === userId) {
      throw new InviteOwnerError();
    }

    const billing = await tx.billings.findOne({ select: BILLING_SELECT, where: { id: invite.billing_id }, lock: true });

    if (billing?.state !== 'active') {
      throw new HttpNotFoundError();
    }

    const user = await tx.users.findOne({
      select: { id: true, name: true, email: true, verified_email: true },
      where: { id: userId, deleted_at: { isNull: true } }
    });

    if (!user) {
      throw new HttpUnauthorizedError();
    }

    if (!user.verified_email || user.verified_email !== user.email) {
      throw new HttpForbiddenError('Confirme seu e-mail antes de participar.');
    }

    const instant = now.toISOString();
    const { split } = await splitFor(tx, billing.id);
    const alreadyIn = split.parts.some((part) => part.kind === 'user' && part.userId === userId);

    // Contacts without e-mail may be this very person: the owner decides, so the guest waits outside the split.
    if (!alreadyIn && (await splitHasPlaceholders(tx, split))) {
      const parked = await tx.billing_guests.findOne({
        select: { id: true, state: true },
        where: { billing_id: billing.id, user_id: userId }
      });

      if (parked?.state === 'pending') {
        return { billingId: billing.id, chargeId: null, joinedSplit: false, awaitingOwner: true };
      }

      if (parked) {
        await tx.billing_guests.updateOne({
          where: { id: parked.id },
          data: { state: 'pending', created_at: instant, resolved_at: sqlNull }
        });
      } else {
        await tx.billing_guests.insertOne({
          data: {
            id: crypto.randomUUID(),
            billing: { id: billing.id },
            owner: { id: billing.owner_id },
            user: { id: userId },
            state: 'pending',
            created_at: instant
          }
        });
      }

      await tx.billing_invites.updateOne({ where: { id: invite.id }, data: { accepted_count: invite.accepted_count + 1 } });
      await audit(tx, billing.owner_id, billing.id, 'billings.guest_waiting', instant, { userId });

      return {
        billingId: billing.id,
        chargeId: null,
        joinedSplit: false,
        awaitingOwner: true,
        waiting: { ownerId: billing.owner_id, description: billing.description, guestName: user.name?.trim() || user.email || 'Alguém' }
      };
    }

    // The guest is the account itself: the agenda entry is all the owner needs.
    await ensureContact(tx, billing.owner_id, userId, instant);

    if (alreadyIn) {
      return {
        billingId: billing.id,
        chargeId: await nearestPendingCharge(tx, billing.id, userId),
        joinedSplit: false,
        awaitingOwner: false
      };
    }

    const { chargeId, joinedSplit } = await joinSplit(tx, billing, userId, instant, noticeChargeIds);

    await tx.billing_invites.updateOne({ where: { id: invite.id }, data: { accepted_count: invite.accepted_count + 1 } });
    await audit(tx, billing.owner_id, billing.id, 'billings.invite_accepted', instant, { userId, joinedSplit });

    return { billingId: billing.id, chargeId, joinedSplit, awaitingOwner: false };
  });

  // The acceptance is committed before the guest hears about their new charge.
  if (notice) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  return result;
}
