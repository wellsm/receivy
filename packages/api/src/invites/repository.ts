import { Order } from '@ez4/database';
import { HttpConflictError, HttpForbiddenError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import { type BillingSplit, type InviteAcceptResult, planBillingCharges, resolveBillingSplit } from '@receivy/common';
import { audit, BILLING_SELECT, type BillingRow, saveAllocations, splitFor } from '../billings/repository';
import { lockOwner, persistChargePlan, prepareChargeMaterialization } from '../charges/materialize';
import { CHARGE_SELECT, type ChargeRow } from '../charges/repository';
import type { DbClient } from '../database';
import { savePerson } from '../people/repository';
import { INVITE_SELECT, resolveInvite } from './links';

export {
  activeInvite,
  createInvite,
  getPublicInvite,
  type InviteLinkContext,
  revokeInvite
} from './links';

async function nearestPendingCharge(db: DbClient, billingId: string, personId: string): Promise<string | null> {
  const { records } = await db.charges.findMany({
    select: { id: true },
    where: { billing_id: billingId, debtor_person_id: personId, state: 'pending' },
    order: { due_date: Order.Asc },
    take: 1
  });

  return records[0]?.id ?? null;
}

function localPart(email: string): string {
  return (email.split('@')[0] || 'Participante').slice(0, 120);
}

/** Links the owner's contact to the accepting account, creating it when the agenda has no match. */
async function contactFor(db: DbClient, ownerId: string, user: { id: string; name?: string; email: string }, now: string): Promise<string> {
  const existing = await db.people.findOne({
    select: { id: true, linked_user_id: true },
    where: { owner_id: ownerId, active_email: user.email },
    lock: true
  });
  const created = existing
    ? undefined
    : await savePerson(db, ownerId, { name: user.name?.trim() || localPart(user.email), email: user.email });
  const personId = existing?.id ?? created!.id;

  // The agenda matched this address to a contact that already belongs to another
  // account; relinking would hand that contact's history to the wrong person.
  if (existing?.linked_user_id && existing.linked_user_id !== user.id) {
    throw new HttpConflictError('Este e-mail já pertence a outro contato.');
  }

  if (existing?.linked_user_id !== user.id) {
    await db.people.updateOne({ where: { id: personId }, data: { linked_user: { id: user.id }, updated_at: now } });
  }

  return personId;
}

/** The guest always joins at the end of the order, with one quota when the split is weighted. */
function withParticipant(split: BillingSplit, personId: string): BillingSplit {
  if (split.mode === 'shares') {
    return { mode: 'shares', parts: [...split.parts, { kind: 'person', personId, shares: 1 }] };
  }

  if (split.mode === 'equal') {
    return { mode: 'equal', parts: [...split.parts, { kind: 'person', personId }] };
  }

  throw new HttpConflictError('Esse rateio não aceita novos participantes.');
}

/** Every charge of a finite billing must still be untouched before its amounts can be reshaped. */
async function assertSplitReshapable(db: DbClient, charges: ChargeRow[]): Promise<void> {
  for (const charge of charges) {
    if (charge.state !== 'pending') {
      throw new HttpConflictError('Divisão já em andamento.');
    }

    if (await db.payment_proofs.count({ where: { charge_id: charge.id } })) {
      throw new HttpConflictError('Divisão já em andamento.');
    }
  }
}

async function reshapeOccurrences(
  db: DbClient,
  billing: BillingRow,
  charges: ChargeRow[],
  split: BillingSplit,
  personId: string,
  now: string
): Promise<string | null> {
  const resolved = new Map(
    resolveBillingSplit(billing.total_cents, split).flatMap((allocation) =>
      allocation.kind === 'person' ? [[allocation.personId, allocation.amountCents] as const] : []
    )
  );
  const occurrences = new Map<string, ChargeRow[]>();

  for (const charge of charges) {
    const key = `${charge.due_date}|${charge.installment ?? ''}`;

    occurrences.set(key, [...(occurrences.get(key) ?? []), charge]);
  }

  const context = await prepareChargeMaterialization(db, billing.owner_id, [personId], billing.payment_method_id);

  let first: string | null = null;

  for (const group of occurrences.values()) {
    for (const charge of group) {
      const amountCents = resolved.get(charge.debtor_person_id);

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
      .filter((charge) => charge.personId === personId)
      .map((charge) => ({
        ...charge,
        installment: sample.installment ?? null,
        installmentCount: sample.installment_count ?? null
      }));

    if (!mine.length) {
      continue;
    }

    const [created] = await persistChargePlan(
      db,
      billing.owner_id,
      { ...plan, charges: mine },
      { id: billing.id, type: billing.type },
      context,
      now
    );

    first ??= created?.id ?? null;
  }

  return first;
}

export async function acceptInvite(
  db: DbClient,
  userId: string,
  token: string,
  secret: string,
  now = new Date()
): Promise<InviteAcceptResult> {
  const preview = await resolveInvite(db, token, secret);

  return db.transaction(async (tx) => {
    await lockOwner(tx, preview.owner_id);

    const invite = await tx.billing_invites.findOne({ select: INVITE_SELECT, where: { id: preview.id }, lock: true });

    if (!invite || invite.revoked_at || new Date(invite.expires_at) <= now) {
      throw new HttpNotFoundError();
    }

    if (invite.owner_id === userId) {
      throw new HttpConflictError('Você é o dono desta cobrança.');
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
    const personId = await contactFor(tx, billing.owner_id, { id: user.id, name: user.name, email: user.email }, instant);
    const { split } = await splitFor(tx, billing.id);

    if (split.parts.some((part) => part.kind === 'person' && part.personId === personId)) {
      return { billingId: billing.id, chargeId: await nearestPendingCharge(tx, billing.id, personId), joinedSplit: false };
    }

    const accepted = { accepted_count: invite.accepted_count + 1 };

    // Fixed and percentage splits carry explicit amounts the owner alone can rebalance.
    if (split.mode === 'fixed' || split.mode === 'percentage') {
      await tx.billing_invites.updateOne({ where: { id: invite.id }, data: accepted });
      await audit(tx, billing.owner_id, billing.id, 'billings.invite_accepted', instant, { personId, joinedSplit: false });

      return { billingId: billing.id, chargeId: null, joinedSplit: false };
    }

    const next = withParticipant(split, personId);
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

    await assertSplitReshapable(tx, charges);
    await saveAllocations(tx, billing.id, billing.total_cents, next, instant);

    const chargeId = charges.length ? await reshapeOccurrences(tx, billing, charges, next, personId, instant) : null;

    await tx.billing_invites.updateOne({ where: { id: invite.id }, data: accepted });
    await audit(tx, billing.owner_id, billing.id, 'billings.invite_accepted', instant, { personId, joinedSplit: true });

    return { billingId: billing.id, chargeId, joinedSplit: true };
  });
}
