import { randomBytes } from 'node:crypto';
import { Order } from '@ez4/database';
import { HttpConflictError, HttpForbiddenError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import {
  type BillingInvite,
  type BillingSplit,
  type InviteAcceptResult,
  type PublicInviteView,
  planBillingCharges,
  resolveBillingSplit
} from '@receivy/common';
import { audit, BILLING_SELECT, type BillingRow, saveAllocations, splitFor } from '../billings/repository';
import { lockOwner, persistChargePlan, prepareChargeMaterialization } from '../charges/materialize';
import { CHARGE_SELECT, type ChargeRow } from '../charges/repository';
import type { DbClient } from '../database';
import { savePerson } from '../people/repository';
import { assertPublicLinkSecretConfigured, issuePublicChargeToken, verifyPublicChargeToken } from '../public/capability';

const INVITE_SELECT = {
  id: true,
  billing_id: true,
  owner_id: true,
  public_id: true,
  expires_at: true,
  revoked_at: true,
  accepted_count: true,
  created_at: true
} as const;

type InviteRow = {
  id: string;
  billing_id: string;
  owner_id: string;
  public_id: string;
  expires_at: string;
  revoked_at?: string;
  accepted_count: number;
  created_at: string;
};

/** The token is deterministic, so the invite row only stores the handle and its deadline. */
const TOKEN_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Verification must not fail on age alone; expiry is compared against the stored deadline instead. */
const IGNORE_EXPIRY = 0;

function seconds(instant: string): number {
  return Math.floor(new Date(instant).getTime() / 1000);
}

function inviteToken(row: Pick<InviteRow, 'public_id' | 'expires_at'>, secret: string): string {
  return issuePublicChargeToken({
    publicId: row.public_id,
    version: TOKEN_VERSION,
    expiresAtSeconds: seconds(row.expires_at),
    secret,
    purpose: 'invite'
  });
}

function inviteResponse(row: Pick<InviteRow, 'public_id' | 'expires_at'>, secret: string, webOrigin: string): BillingInvite {
  return { url: `${webOrigin.replace(/\/+$/, '')}/join/${inviteToken(row, secret)}`, expiresAt: row.expires_at };
}

async function ownedBilling(db: DbClient, ownerId: string, billingId: string, lock = false): Promise<BillingRow> {
  const row = await db.billings.findOne({ select: BILLING_SELECT, where: { id: billingId, owner_id: ownerId }, lock });

  if (!row) {
    throw new HttpNotFoundError();
  }

  return row;
}

async function revokeActive(db: DbClient, billingId: string, now: string): Promise<void> {
  await db.billing_invites.updateMany({ where: { billing_id: billingId, revoked_at: { isNull: true } }, data: { revoked_at: now } });
}

export async function createInvite(
  db: DbClient,
  ownerId: string,
  billingId: string,
  secret: string,
  webOrigin: string,
  now = new Date()
): Promise<BillingInvite> {
  assertPublicLinkSecretConfigured(secret);

  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const billing = await ownedBilling(tx, ownerId, billingId, true);

    if (billing.state !== 'active') {
      throw new HttpConflictError('Só cobranças ativas aceitam convite.');
    }

    const instant = now.toISOString();

    await revokeActive(tx, billing.id, instant);

    const created = await tx.billing_invites.insertOne({
      select: INVITE_SELECT,
      data: {
        id: crypto.randomUUID(),
        billing: { id: billing.id },
        owner: { id: ownerId },
        public_id: randomBytes(16).toString('base64url'),
        expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
        accepted_count: 0,
        created_at: instant
      }
    });

    return inviteResponse(created, secret, webOrigin);
  });
}

export async function revokeInvite(db: DbClient, ownerId: string, billingId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const billing = await ownedBilling(tx, ownerId, billingId, true);

    await revokeActive(tx, billing.id, now.toISOString());
  });
}

/** Re-issues the URL of the still-usable invite; nothing is stored between reads. */
export async function activeInvite(
  db: DbClient,
  billingId: string,
  secret: string,
  webOrigin: string,
  now = new Date()
): Promise<BillingInvite | null> {
  if (!secret || secret === 'disabled') {
    return null;
  }

  const { records } = await db.billing_invites.findMany({
    select: INVITE_SELECT,
    where: { billing_id: billingId, revoked_at: { isNull: true }, expires_at: { gt: now.toISOString() } },
    order: { created_at: Order.Desc },
    take: 1
  });

  const row = records[0];

  return row ? inviteResponse(row, secret, webOrigin) : null;
}

/** Resolves the signed handle; a bad signature or an unknown handle is indistinguishable from a miss. */
async function resolveInvite(db: DbClient, token: string, secret: string): Promise<InviteRow> {
  assertPublicLinkSecretConfigured(secret);

  const publicId = token.split('.')[0];

  if (!publicId) {
    throw new HttpNotFoundError();
  }

  const row = await db.billing_invites.findOne({ select: INVITE_SELECT, where: { public_id: publicId } });

  if (!row) {
    throw new HttpNotFoundError();
  }

  let capability: { publicId: string; expiresAtSeconds: number };

  try {
    capability = verifyPublicChargeToken(token, { version: TOKEN_VERSION, nowSeconds: IGNORE_EXPIRY, secret, purpose: 'invite' });
  } catch {
    throw new HttpNotFoundError();
  }

  if (capability.expiresAtSeconds !== seconds(row.expires_at)) {
    throw new HttpNotFoundError();
  }

  return row;
}

export async function getPublicInvite(db: DbClient, token: string, secret: string, now = new Date()): Promise<PublicInviteView> {
  const invite = await resolveInvite(db, token, secret);
  const billing = await db.billings.findOne({ select: BILLING_SELECT, where: { id: invite.billing_id } });

  if (!billing) {
    throw new HttpNotFoundError();
  }

  const owner = await db.users.findOne({ select: { name: true }, where: { id: invite.owner_id } });

  return {
    creditorFirstName: owner?.name?.trim().split(/\s+/)[0] || 'Pessoa',
    description: billing.description,
    amount: { amountCents: billing.total_cents, currency: billing.currency },
    type: billing.type,
    participantCount: await db.allocations.count({ where: { billing_id: billing.id, kind: 'person' } }),
    category: billing.category,
    expired: !!invite.revoked_at || new Date(invite.expires_at) <= now || billing.state !== 'active'
  };
}

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
