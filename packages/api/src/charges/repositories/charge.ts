import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { ChargeDetail, ChargeProof } from '@receivy/common';
import { recordEvent } from '../../common/repositories/events';
import { counterpartOf, displayNameFor } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { lockAccountReferences } from '../../users/services/locking';
import { ChargeClosedError, ChargeNotPaidError } from '../errors';

const sqlNull = null as unknown as undefined;

export const CHARGE_SELECT = {
  id: true,
  creditor_id: true,
  debtor_user_id: true,
  payer: true,
  billing_id: true,
  billing_type: true,
  description: true,
  amount_cents: true,
  currency: true,
  due_date: true,
  installment: true,
  installment_count: true,
  pix_key_type_snapshot: true,
  pix_key_snapshot: true,
  pix_label_snapshot: true,
  state: true,
  cancelled_at: true,
  paid_at: true,
  proof_state: true,
  proof_file: true,
  proof_sender_user_id: true,
  proof_actor_hash: true,
  proof_expires_at: true,
  proof_sent_at: true,
  proof_reviewed_at: true,
  proof_reason: true,
  public_id: true,
  link_version: true,
  link_expires_at: true,
  link_revoked_at: true,
  created_at: true,
  updated_at: true
} as const;

export type ProofFileColumns = {
  key: string;
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'application/pdf';
  size: number;
  sha256?: string;
};

export type ChargeRow = {
  id: string;
  /** The billing owner, whichever side of the money they are on. */
  creditor_id: string;
  /** The person on the other side (users.id); undefined only on a conta a pagar without a payee. */
  debtor_user_id?: string;
  /** Who pays: undefined or 'person' on a conta a receber, 'owner' on a conta a pagar. */
  payer?: 'person' | 'owner';
  billing_id: string;
  billing_type: 'once' | 'until' | 'indefinite';
  description: string;
  amount_cents: number;
  currency: 'BRL';
  due_date: string;
  installment?: number;
  installment_count?: number;
  pix_key_type_snapshot?: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  pix_key_snapshot?: string;
  pix_label_snapshot?: string;
  state: 'pending' | 'paid' | 'cancelled';
  cancelled_at?: string;
  paid_at?: string;
  proof_state?: 'uploading' | 'pending' | 'accepted' | 'rejected';
  proof_file?: ProofFileColumns;
  proof_sender_user_id?: string;
  proof_actor_hash?: string;
  proof_expires_at?: string;
  proof_sent_at?: string;
  proof_reviewed_at?: string;
  proof_reason?: string;
  public_id?: string;
  link_version?: number;
  link_expires_at?: string;
  link_revoked_at?: string;
  created_at: string;
  updated_at: string;
};

/** The attached file as the viewer may see it: a reserved slot is nobody's business yet. */
export function proofOf(row: ChargeRow, viewerId: string): ChargeProof | null {
  if (!row.proof_state || row.proof_state === 'uploading' || !row.proof_file || !row.proof_sent_at) {
    return null;
  }

  return {
    state: row.proof_state,
    file: { name: row.proof_file.name, mime: row.proof_file.mime, size: row.proof_file.size },
    sentAt: row.proof_sent_at,
    reviewedAt: row.proof_reviewed_at ?? null,
    reason: row.proof_reason ?? null,
    sentByViewer: row.proof_sender_user_id === viewerId
  };
}

/** `payer` is null on rows written before contas a pagar existed; they are contact-paid. */
export function chargePayer(row: Pick<ChargeRow, 'payer'>): 'person' | 'owner' {
  return row.payer ?? 'person';
}

/** The owner of the billing behind the charge: every owner power keys on this, never on direction. */
export function ownsCharge(row: Pick<ChargeRow, 'creditor_id'>, userId: string): boolean {
  return row.creditor_id === userId;
}

/**
 * Direction is derived, never stored: the owner side of a conta a receber collects, the owner side of a
 * conta a pagar pays, and the counterpart (recipient) side is always the inverse.
 */
export function chargeDirection(row: Pick<ChargeRow, 'creditor_id' | 'payer'>, userId: string): 'receivable' | 'payable' {
  const ownerSide = ownsCharge(row, userId);
  const ownerPays = chargePayer(row) === 'owner';

  return ownerSide !== ownerPays ? 'receivable' : 'payable';
}

/** Name shown on the other side of a charge, as the viewer knows that person (nickname first). */
export async function counterpartName(db: DbClient, row: ChargeRow, userId: string): Promise<string> {
  if (!ownsCharge(row, userId)) {
    return displayNameFor(db, userId, row.creditor_id);
  }

  // A conta a pagar without a payee is the owner's alone.
  if (!row.debtor_user_id) {
    return 'Você';
  }

  return displayNameFor(db, userId, row.debtor_user_id);
}

/** A reminder needs an address: the debtor's e-mail or phone; a bill with no debtor has nobody to remind. */
async function reachable(db: DbClient, row: ChargeRow): Promise<boolean> {
  const person = await counterpartOf(db, row.debtor_user_id);
  return !!person && !!(person.email || person.phone);
}

export async function chargeDto(db: DbClient, row: ChargeRow, userId: string): Promise<ChargeDetail> {
  const direction = chargeDirection(row, userId);
  const payer = chargePayer(row);
  const hasPix = !!row.pix_key_snapshot && !!row.pix_key_type_snapshot;

  return {
    id: row.id,
    description: row.description,
    amount: { amountCents: row.amount_cents, currency: row.currency },
    dueDate: row.due_date,
    state: row.state,
    billingId: row.billing_id,
    billingType: row.billing_type,
    installment: row.installment ?? null,
    installmentCount: row.installment_count ?? null,
    counterpartName: await counterpartName(db, row, userId),
    counterpartReachable: await reachable(db, row),
    proofState: row.proof_state && row.proof_state !== 'uploading' ? row.proof_state : null,
    payer,
    ownedByViewer: ownsCharge(row, userId),
    hasPix,
    direction,
    recipient: await recipientOf(db, row),
    debtorUserId: row.debtor_user_id ?? null,
    // A conta a pagar never publishes a link: the owner already holds the Pix key they typed.
    sharingState:
      row.state !== 'pending' || payer === 'owner' ? 'closed' : hasPix ? 'ready' : row.public_id ? 'legacy_without_pix' : 'pix_required',
    pix:
      row.pix_key_type_snapshot && row.pix_key_snapshot
        ? { keyType: row.pix_key_type_snapshot, key: row.pix_key_snapshot, label: row.pix_label_snapshot ?? 'Pix' }
        : null,
    proof: proofOf(row, userId),
    cancelledAt: row.cancelled_at ?? null,
    paidAt: row.paid_at ?? null,
    createdAt: row.created_at
  };
}

export async function findChargeForActor(
  db: DbClient,
  actorId: string,
  id: string,
  lock = false
): Promise<{ row: ChargeRow; direction: 'receivable' | 'payable' }> {
  if (lock) await lockAccountReferences(db, 'write');
  if (
    !(await db.users.findOne({
      select: { id: true },
      where: { id: actorId, deleted_at: { isNull: true } },
      ...(lock ? { lock: true } : {})
    }))
  )
    throw new HttpForbiddenError();
  const row = await db.charges.findOne({ select: CHARGE_SELECT, where: { id }, ...(lock ? { lock: true } : {}) });
  if (!row) throw new HttpNotFoundError();
  if (ownsCharge(row, actorId)) return { row, direction: chargeDirection(row, actorId) };
  if (row.debtor_user_id === actorId) return { row, direction: chargeDirection(row, actorId) };
  throw new HttpForbiddenError();
}

export async function getCharge(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
  const { row } = await findChargeForActor(db, actorId, id);
  return chargeDto(db, row, actorId);
}

async function activity(
  db: DbClient,
  input: { actorId: string; row: ChargeRow; type: string; now: string; payload?: Record<string, unknown> }
) {
  await recordEvent(db, {
    type: input.type,
    eventableType: 'charge',
    eventableId: input.row.id,
    actorId: input.actorId,
    payload: input.payload,
    at: input.now
  });
}

export async function cancelCharge(db: DbClient, creditorId: string, id: string): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const { row } = await findChargeForActor(tx, creditorId, id, true);
    // Only the owner cancels a single charge, and a conta a pagar is ended as a whole instead.
    if (!ownsCharge(row, creditorId) || chargePayer(row) === 'owner') throw new HttpForbiddenError();
    if (row.state === 'cancelled') return chargeDto(tx, row, creditorId);
    if (row.state !== 'pending') throw new ChargeClosedError();
    const now = new Date().toISOString();
    const changed = await tx.charges.updateOne({
      select: { id: true },
      where: { id },
      data: { state: 'cancelled', cancelled_at: now, updated_at: now }
    });
    if (!changed) throw new HttpNotFoundError();
    const updated = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id } });
    if (!updated) throw new HttpNotFoundError();
    await activity(tx, { actorId: creditorId, row: updated, type: 'charge.cancelled', now });
    return chargeDto(tx, updated, creditorId);
  });
}

/** Whoever collects settles by hand; the owner of a conta a pagar settles their own bill the same way. */
export async function payCharge(db: DbClient, actorId: string, id: string, now = new Date()): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(tx, actorId, id, true);
    if (direction !== 'receivable' && !ownsCharge(row, actorId)) throw new HttpForbiddenError();
    if (row.state !== 'pending') throw new ChargeClosedError();
    const stamp = now.toISOString();
    const changed = await tx.charges.updateOne({
      select: { id: true },
      where: { id },
      data: { state: 'paid', paid_at: stamp, updated_at: stamp }
    });
    if (!changed) throw new HttpNotFoundError();
    const updated = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id } });
    if (!updated) throw new HttpNotFoundError();
    await activity(tx, { actorId, row: updated, type: 'charge.paid', now: stamp, payload: { via: 'manual' } });
    return chargeDto(tx, updated, actorId);
  });
}

/**
 * Undoes a settlement: the payment row goes, the charge is pending again and whatever proof the
 * settlement had answered (accepted, or closed by the manual payment) goes back to review. The
 * same people who may settle a charge may take it back.
 */
export async function reopenCharge(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
  return db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(tx, actorId, id, true);
    if (direction !== 'receivable' && !ownsCharge(row, actorId)) throw new HttpForbiddenError();
    if (row.state !== 'paid') throw new ChargeNotPaidError();
    const now = new Date().toISOString();
    // A file the settlement had accepted goes back under review; a manual settlement never touched it.
    const changed = await tx.charges.updateOne({
      select: { id: true },
      where: { id },
      data: {
        state: 'pending',
        paid_at: sqlNull,
        ...(row.proof_state === 'accepted' ? { proof_state: 'pending', proof_reviewed_at: sqlNull, proof_reason: sqlNull } : {}),
        updated_at: now
      }
    });
    if (!changed) throw new HttpNotFoundError();
    const updated = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id } });
    if (!updated) throw new HttpNotFoundError();
    await activity(tx, { actorId, row: updated, type: 'charge.reopened', now });
    return chargeDto(tx, updated, actorId);
  });
}

/** The person on the other side of the money, read live; a bill that is the owner's alone names the owner. */
async function recipientOf(db: DbClient, row: ChargeRow): Promise<ChargeDetail['recipient']> {
  const person = await counterpartOf(db, row.debtor_user_id);

  if (person) {
    return { userId: row.debtor_user_id!, name: person.name, email: person.email };
  }

  const owner = await counterpartOf(db, row.creditor_id);

  return { userId: null, name: owner?.name ?? 'Conta excluída', email: null };
}
