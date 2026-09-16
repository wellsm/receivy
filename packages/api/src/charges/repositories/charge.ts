import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import {
  type BillingType,
  type ChargeDetail,
  ChargePayer,
  type ChargeProof,
  ChargeState,
  Direction,
  type PixKeyType,
  ProofKind,
  type ProofMime,
  ProofState,
  SharingState,
  type UserAvatar,
  UserStatus,
  zonedInstant
} from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { ProofDeclarationForbiddenError } from '../../proofs/errors';
import { lockAccountReferences } from '../../users/services/locking';
import { ChargeClosedError, ChargeNotPaidError, SilenceUnavailableError } from '../errors';
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

/** The person on the other side of the money, read live; a registro names its counterpart, a bill that is the owner's alone names the owner. */
async function recipientOf(db: DbClient, row: ChargeRepository.Row): Promise<ChargeDetail['recipient']> {
  const person = await ContactRepository.counterpartOf(db, row.debtor_user_id);

  if (person) {
    return { userId: row.debtor_user_id!, name: person.name, email: person.email, avatar: person.avatar };
  }

  const { counterpartLabel } = await ChargeRepository.settledBilling(db, row);

  if (counterpartLabel) {
    return { userId: null, name: counterpartLabel, email: null, avatar: null };
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
    description: true,
    amount_cents: true,
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
    proof_kind: true,
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
    silenced: true,
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
    description: string;
    amount_cents: number;
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
    proof_kind?: ProofKind;
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
    /** "Não notificar" of this charge; undefined reads as false. */
    silenced?: boolean;
    created_at: string;
    updated_at: string;
  };

  export function list(db: DbClient, userId: String.UUID, _query: { month: string }) {
    return db.charges.findMany({
      select: {
        id: true,
        description: true,
        state: true,
      },
      where: {
        OR: [{ creditor_id: userId }, { debtor_user_id: userId }]
      }
    });
  }

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

  /** The attached proof as the viewer may see it: a reserved slot is nobody's business yet, and a declaration has no file. */
  export function proofOf(row: Row, viewerId: string): ChargeProof | null {
    const state = visibleProofState(row);
    const kind = row.proof_kind ?? ProofKind.File;
    // A declaration has no file, not even one still on its way over it.
    const file = kind === ProofKind.File ? row.proof_file : undefined;

    if (!state || !row.proof_sent_at || (kind === ProofKind.File && !file)) {
      return null;
    }

    return {
      state,
      kind,
      file: file ? { name: file.name, mime: file.mime, size: file.size } : null,
      sentAt: row.proof_sent_at,
      reviewedAt: row.proof_reviewed_at ?? null,
      reason: row.proof_reason ?? null,
      sentByViewer: row.proof_sender_user_id === viewerId
    };
  }

  /** What is under review, when anything is. Rows written before declarations existed carry files. */
  export function proofKind(row: Pick<Row, 'proof_state' | 'proof_kind'>): ProofKind | null {
    return row.proof_state ? (row.proof_kind ?? ProofKind.File) : null;
  }

  /**
   * Whether a payment the paying side declares waits for the other side. The owner of a conta a receber can
   * always answer; the payee of a conta a pagar only with an active account, otherwise the bill settles at once.
   */
  export async function confirmationRequired(db: DbClient, row: Pick<Row, 'payer' | 'debtor_user_id'>): Promise<boolean> {
    if (payer(row) !== ChargePayer.Owner) {
      return true;
    }

    return (await ContactRepository.counterpartOf(db, row.debtor_user_id))?.status === UserStatus.Active;
  }

  /** `payer` is null on rows written before contas a pagar existed; they are contact-paid. */
  export function payer(row: Pick<Row, 'payer'>): ChargePayer {
    return row.payer ?? ChargePayer.Person;
  }

  /** The owner of the billing behind the charge: every owner power keys on this, never on direction. */
  export function owns(row: Pick<Row, 'creditor_id'>, userId: string): boolean {
    return row.creditor_id === userId;
  }

  /** The billing behind a charge: its type, whether it is a registro, and the counterpart it names. */
  export type SettledBilling = { settled: boolean; counterpartLabel: string | null; type: BillingType };

  export async function settledBilling(db: DbClient, row: Pick<Row, 'billing_id'>): Promise<SettledBilling> {
    const billing = await db.billings.findOne({
      select: { settled: true, counterpart_label: true, type: true },
      where: { id: row.billing_id }
    });

    // A charge always points at a billing; a missing one is corruption, not an empty state.
    if (!billing) {
      throw new HttpNotFoundError();
    }

    return { settled: billing.settled === true, counterpartLabel: billing.counterpart_label ?? null, type: billing.type };
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

    // Nobody on the other side: a registro names its counterpart; a conta a pagar without a payee is the owner's alone.
    if (!row.debtor_user_id) {
      return (await settledBilling(db, row)).counterpartLabel ?? 'Você';
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
    const record = await settledBilling(db, row);

    return {
      id: row.id,
      description: row.description,
      amount: { amountCents: row.amount_cents, currency: 'BRL' },
      dueDate: row.due_date,
      state: row.state,
      billingId: row.billing_id,
      billingType: record.type,
      installment: row.installment ?? null,
      installmentCount: row.installment_count ?? null,
      counterpartName: await counterpartName(db, row, userId),
      counterpartAvatar: await counterpartAvatar(db, row, userId),
      counterpartReachable: await reachable(db, row),
      proofState: visibleProofState(row),
      proofKind: proofKind(row),
      confirmationRequired: await confirmationRequired(db, row),
      // Only the creditor sees the switch: whoever owes reads every charge the same.
      silenced: owns(row, userId) && row.silenced === true,
      settled: record.settled,
      counterpartLabel: record.counterpartLabel,
      payer,
      ownedByViewer: owns(row, userId),
      hasPix,
      direction,
      recipient: await recipientOf(db, row),
      debtorUserId: row.debtor_user_id ?? null,
      // A conta a pagar never publishes a link: the owner already holds the Pix key they typed.
      sharingState:
        row.state !== ChargeState.Pending || payer === ChargePayer.Owner || record.settled
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

  /**
   * The creditor of a conta a receber pauses or resumes the automatic notices of one pending charge. Anyone else
   * gets a 404; sending the value already stored answers without writing or recording anything.
   */
  export async function silence(db: DbClient, creditorId: string, id: string, silenced: boolean, now = new Date()): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      await lockAccountReferences(tx, 'write');

      const row = await tx.charges.findOne({ select: SELECT, where: { id, creditor_id: creditorId }, lock: true });

      if (!row) {
        throw new HttpNotFoundError();
      }

      if (payer(row) === ChargePayer.Owner) {
        throw new SilenceUnavailableError();
      }

      if (row.state !== ChargeState.Pending) {
        throw new ChargeClosedError();
      }

      const current = row.silenced === true;

      if (current === silenced) {
        return dto(tx, row, creditorId);
      }

      const stamp = now.toISOString();

      await tx.charges.updateOne({ where: { id }, data: { silenced, updated_at: stamp } });

      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });

      if (!updated) {
        throw new HttpNotFoundError();
      }

      await activity(tx, { actorId: creditorId, row: updated, type: silenced ? 'charge.silenced' : 'charge.unsilenced', now: stamp });

      return dto(tx, updated, creditorId);
    });
  }

  /**
   * A registro's charge settles on its own due date: paid at the start of that day in the billing timezone, recorded as
   * `charge.paid { via: 'registered' }` by the owner. The caller has already checked it is pending.
   */
  export async function markRegistered(db: DbClient, row: Row, timezone: string, now: string): Promise<Row> {
    await db.charges.updateOne({
      where: { id: row.id },
      data: { state: ChargeState.Paid, paid_at: zonedInstant(row.due_date, '00:00', timezone), updated_at: now }
    });

    const updated = await db.charges.findOne({ select: SELECT, where: { id: row.id } });

    if (!updated) {
      throw new HttpNotFoundError();
    }

    await activity(db, { actorId: row.creditor_id, row: updated, type: 'charge.paid', now, payload: { via: 'registered' } });

    return updated;
  }

  /**
   * Whoever collects settles by hand, and a file or declaration waiting in review counts as accepted. The owner
   * of a conta a pagar settles alone only when no payee can confirm; otherwise they declare the payment.
   */
  export async function pay(db: DbClient, actorId: string, id: string, now = new Date()): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      const { row, direction } = await findForActor(tx, actorId, id, true);
      if (direction !== Direction.Receivable && !owns(row, actorId)) throw new HttpForbiddenError();
      if (row.state !== ChargeState.Pending) throw new ChargeClosedError();
      if (direction === Direction.Payable && (await confirmationRequired(tx, row))) throw new ProofDeclarationForbiddenError();
      const stamp = now.toISOString();
      const answering = row.proof_state === StoredProofState.Pending;
      const declaration = row.proof_kind === ProofKind.Declaration;
      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: {
          state: ChargeState.Paid,
          paid_at: stamp,
          ...(answering ? { proof_state: StoredProofState.Accepted, proof_reviewed_at: stamp, proof_reason: sqlNull } : {}),
          // A file still on its way over the answered declaration has nothing left to attach to.
          ...(answering && declaration ? { proof_file: sqlNull, proof_expires_at: sqlNull } : {}),
          updated_at: stamp
        }
      });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });
      if (!updated) throw new HttpNotFoundError();
      if (answering) {
        await activity(tx, {
          actorId,
          row: updated,
          type: 'proof.accepted',
          now: stamp,
          payload: { name: declaration ? undefined : row.proof_file?.name }
        });
      }
      let via = 'manual';

      if (answering) {
        via = declaration ? 'declaration' : 'proof';
      }

      await activity(tx, { actorId, row: updated, type: 'charge.paid', now: stamp, payload: { via } });
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
