import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import {
  type BillingType,
  type ChargeDetail,
  ChargePayer,
  type ChargeProof,
  ChargeState,
  Direction,
  type PixKeyType,
  type ProofMime,
  ProofState,
  SharingState,
  type UserAvatar
} from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { lockAccountReferences } from '../../users/services/locking';
import { ChargeClosedError, ChargeNotPaidError } from '../errors';
import { StoredProofState } from '../schemas/charge';

const sqlNull = null as unknown as undefined;

/** A reminder needs an address: the debtor's e-mail or phone; a bill with no debtor has nobody to remind. */
async function reachable(db: DbClient, row: ChargeRepository.Row): Promise<boolean> {
  const person = await ContactRepository.counterpartOf(db, row.debtor_user_id);
  return !!person && !!(person.email || person.phone);
}

async function activity(
  db: DbClient,
  input: { actorId: string; row: ChargeRepository.Row; type: string; now: string; payload?: Record<string, unknown> }
) {
  await EventRepository.record(db, {
    type: input.type,
    eventableType: EventableType.Charge,
    eventableId: input.row.id,
    actorId: input.actorId,
    payload: input.payload,
    at: input.now
  });
}

/** The person on the other side of the money, read live; a bill that is the owner's alone names the owner. */
async function recipientOf(db: DbClient, row: ChargeRepository.Row): Promise<ChargeDetail['recipient']> {
  const person = await ContactRepository.counterpartOf(db, row.debtor_user_id);

  if (person) {
    return { userId: row.debtor_user_id!, name: person.name, email: person.email, avatar: person.avatar };
  }

  const owner = await ContactRepository.counterpartOf(db, row.creditor_id);

  return { userId: null, name: owner?.name ?? 'Conta excluída', email: null, avatar: owner?.avatar ?? null };
}

export namespace ChargeRepository {
  export const SELECT = {
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
    mime: ProofMime;
    size: number;
    sha256?: string;
  };

  export type Row = {
    id: string;
    /** The billing owner, whichever side of the money they are on. */
    creditor_id: string;
    /** The person on the other side (users.id); undefined only on a conta a pagar without a payee. */
    debtor_user_id?: string;
    /** Who pays: undefined or 'person' on a conta a receber, 'owner' on a conta a pagar. */
    payer?: ChargePayer;
    billing_id: string;
    billing_type: BillingType;
    description: string;
    amount_cents: number;
    currency: 'BRL';
    due_date: string;
    installment?: number;
    installment_count?: number;
    pix_key_type_snapshot?: PixKeyType;
    pix_key_snapshot?: string;
    pix_label_snapshot?: string;
    state: ChargeState;
    cancelled_at?: string;
    paid_at?: string;
    proof_state?: StoredProofState;
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

  /** The stored proof state as anyone may see it: a reserved slot (`uploading`) is nobody's business yet. */
  export function visibleProofState(row: Pick<Row, 'proof_state'>): ProofState | null {
    switch (row.proof_state) {
      case StoredProofState.Pending:
        return ProofState.Pending;

      case StoredProofState.Accepted:
        return ProofState.Accepted;

      case StoredProofState.Rejected:
        return ProofState.Rejected;

      default:
        return null;
    }
  }

  /** The attached file as the viewer may see it: a reserved slot is nobody's business yet. */
  export function proofOf(row: Row, viewerId: string): ChargeProof | null {
    const state = visibleProofState(row);

    if (!state || !row.proof_file || !row.proof_sent_at) {
      return null;
    }

    return {
      state,
      file: { name: row.proof_file.name, mime: row.proof_file.mime, size: row.proof_file.size },
      sentAt: row.proof_sent_at,
      reviewedAt: row.proof_reviewed_at ?? null,
      reason: row.proof_reason ?? null,
      sentByViewer: row.proof_sender_user_id === viewerId
    };
  }

  /** `payer` is null on rows written before contas a pagar existed; they are contact-paid. */
  export function payer(row: Pick<Row, 'payer'>): ChargePayer {
    return row.payer ?? ChargePayer.Person;
  }

  /** The owner of the billing behind the charge: every owner power keys on this, never on direction. */
  export function owns(row: Pick<Row, 'creditor_id'>, userId: string): boolean {
    return row.creditor_id === userId;
  }

  /**
   * Direction is derived, never stored: the owner side of a conta a receber collects, the owner side of a
   * conta a pagar pays, and the counterpart (recipient) side is always the inverse.
   */
  export function direction(row: Pick<Row, 'creditor_id' | 'payer'>, userId: string): Direction {
    const ownerSide = owns(row, userId);
    const ownerPays = payer(row) === ChargePayer.Owner;

    return ownerSide !== ownerPays ? Direction.Receivable : Direction.Payable;
  }

  /** Name shown on the other side of a charge, as the viewer knows that person (nickname first). */
  export async function counterpartName(db: DbClient, row: Row, userId: string): Promise<string> {
    if (!owns(row, userId)) {
      return ContactRepository.displayNameFor(db, userId, row.creditor_id);
    }

    // A conta a pagar without a payee is the owner's alone.
    if (!row.debtor_user_id) {
      return 'Você';
    }

    return ContactRepository.displayNameFor(db, userId, row.debtor_user_id);
  }

  /** Photo of the person `counterpartName` names; null on a bill that is the owner's alone. */
  export async function counterpartAvatar(db: DbClient, row: Row, userId: string): Promise<UserAvatar | null> {
    const otherId = owns(row, userId) ? row.debtor_user_id : row.creditor_id;

    if (!otherId) {
      return null;
    }

    return (await ContactRepository.counterpartOf(db, otherId))?.avatar ?? null;
  }

  export async function dto(db: DbClient, row: Row, userId: string): Promise<ChargeDetail> {
    const direction = ChargeRepository.direction(row, userId);
    const payer = ChargeRepository.payer(row);
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
      counterpartAvatar: await counterpartAvatar(db, row, userId),
      counterpartReachable: await reachable(db, row),
      proofState: visibleProofState(row),
      payer,
      ownedByViewer: owns(row, userId),
      hasPix,
      direction,
      recipient: await recipientOf(db, row),
      debtorUserId: row.debtor_user_id ?? null,
      // A conta a pagar never publishes a link: the owner already holds the Pix key they typed.
      sharingState:
        row.state !== ChargeState.Pending || payer === ChargePayer.Owner
          ? SharingState.Closed
          : hasPix
            ? SharingState.Ready
            : row.public_id
              ? SharingState.LegacyWithoutPix
              : SharingState.PixRequired,
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

  export async function findForActor(db: DbClient, actorId: string, id: string, lock = false): Promise<{ row: Row; direction: Direction }> {
    if (lock) await lockAccountReferences(db, 'write');
    if (
      !(await db.users.findOne({
        select: { id: true },
        where: { id: actorId, deleted_at: { isNull: true } },
        ...(lock ? { lock: true } : {})
      }))
    )
      throw new HttpForbiddenError();
    const row = await db.charges.findOne({ select: SELECT, where: { id }, ...(lock ? { lock: true } : {}) });
    if (!row) throw new HttpNotFoundError();
    if (owns(row, actorId)) return { row, direction: direction(row, actorId) };
    if (row.debtor_user_id === actorId) return { row, direction: direction(row, actorId) };
    throw new HttpForbiddenError();
  }

  export async function get(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
    const { row } = await findForActor(db, actorId, id);
    return dto(db, row, actorId);
  }

  export async function cancel(db: DbClient, creditorId: string, id: string): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      const { row } = await findForActor(tx, creditorId, id, true);
      // Only the owner cancels a single charge, and a conta a pagar is ended as a whole instead.
      if (!owns(row, creditorId) || payer(row) === ChargePayer.Owner) throw new HttpForbiddenError();
      if (row.state === ChargeState.Cancelled) return dto(tx, row, creditorId);
      if (row.state !== ChargeState.Pending) throw new ChargeClosedError();
      const now = new Date().toISOString();
      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: { state: ChargeState.Cancelled, cancelled_at: now, updated_at: now }
      });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });
      if (!updated) throw new HttpNotFoundError();
      await activity(tx, { actorId: creditorId, row: updated, type: 'charge.cancelled', now });
      return dto(tx, updated, creditorId);
    });
  }

  /** Whoever collects settles by hand; the owner of a conta a pagar settles their own bill the same way. */
  export async function pay(db: DbClient, actorId: string, id: string, now = new Date()): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      const { row, direction } = await findForActor(tx, actorId, id, true);
      if (direction !== Direction.Receivable && !owns(row, actorId)) throw new HttpForbiddenError();
      if (row.state !== ChargeState.Pending) throw new ChargeClosedError();
      const stamp = now.toISOString();
      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: { state: ChargeState.Paid, paid_at: stamp, updated_at: stamp }
      });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });
      if (!updated) throw new HttpNotFoundError();
      await activity(tx, { actorId, row: updated, type: 'charge.paid', now: stamp, payload: { via: 'manual' } });
      return dto(tx, updated, actorId);
    });
  }

  /**
   * Undoes a settlement: the payment row goes, the charge is pending again and whatever proof the
   * settlement had answered (accepted, or closed by the manual payment) goes back to review. The
   * same people who may settle a charge may take it back.
   */
  export async function reopen(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      const { row, direction } = await findForActor(tx, actorId, id, true);
      if (direction !== Direction.Receivable && !owns(row, actorId)) throw new HttpForbiddenError();
      if (row.state !== ChargeState.Paid) throw new ChargeNotPaidError();
      const now = new Date().toISOString();
      // A file the settlement had accepted goes back under review; a manual settlement never touched it.
      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: {
          state: ChargeState.Pending,
          paid_at: sqlNull,
          ...(row.proof_state === StoredProofState.Accepted
            ? { proof_state: StoredProofState.Pending, proof_reviewed_at: sqlNull, proof_reason: sqlNull }
            : {}),
          updated_at: now
        }
      });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });
      if (!updated) throw new HttpNotFoundError();
      await activity(tx, { actorId, row: updated, type: 'charge.reopened', now });
      return dto(tx, updated, actorId);
    });
  }
}
