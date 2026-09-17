import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import {
  BillingKind,
  type BillingRecurrence,
  type ChargeDetail,
  type ChargeProof,
  ChargeState,
  Direction,
  endOfMonth,
  type PixKeyType,
  ProofKind,
  ProofState,
  SharingState,
  startOfMonth,
  type UserAvatar,
  UserStatus,
  zonedInstant
} from '@receivy/common';
import { billingKind, billingRecurrence } from '../../billings/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { ProofDeclarationForbiddenError } from '../../proofs/errors';
import { currentProof, type ProofRow } from '../../proofs/repositories/proof-row';
import { LinkRepository } from '../../public/repositories/link';
import { LinkableType } from '../../public/schemas/link';
import { lockAccountReferences } from '../../users/services/locking';
import { ChargeClosedError, ChargeNotPaidError, SilenceUnavailableError } from '../errors';
import type { PaymentMethodKind } from '../schemas/charge';
import { StoredProofState } from '../schemas/charge';

const sqlNull = null as unknown as undefined;

/** A reminder needs an address: the counterpart's e-mail or phone; a bill with nobody on the other side has nobody to remind. */
async function reachable(db: DbClient, row: ChargeRepository.Row): Promise<boolean> {
  const person = await ContactRepository.counterpartOf(db, ChargeRepository.counterpartId(row));
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
  const counterpartId = ChargeRepository.counterpartId(row);
  const person = await ContactRepository.counterpartOf(db, counterpartId);

  if (person) {
    return { userId: counterpartId!, name: person.name, email: person.email, avatar: person.avatar };
  }

  const owner = await ContactRepository.counterpartOf(db, ChargeRepository.ownerOf(row));

  return { userId: null, name: owner?.name ?? 'Conta excluída', email: null, avatar: owner?.avatar ?? null };
}

export namespace ChargeRepository {
  export const SELECT = {
    id: true,
    owner_id: true,
    creditor_id: true,
    debtor_id: true,
    billing_id: true,
    description: true,
    amount_cents: true,
    due_date: true,
    installment: true,
    installment_count: true,
    payment_snapshot: true,
    state: true,
    cancelled_at: true,
    paid_at: true,
    notify: true,
    created_at: true,
    updated_at: true
  } as const;

  export type PaymentSnapshotColumns = {
    method: PaymentMethodKind;
    type: PixKeyType;
    value: string;
    label: string;
  };

  /** How this charge is paid, frozen at the moment it was published. */
  export function paymentOf(row: Pick<Row, 'payment_snapshot'>): PaymentSnapshotColumns | null {
    return row.payment_snapshot ?? null;
  }

  export type Row = {
    id: string;
    /** The billing owner, whichever side of the money they are on. */
    owner_id: string;
    /** Who receives; undefined on a conta a pagar without a payee. */
    creditor_id?: string;
    /** Who pays; undefined on a registro with nobody on the other side. */
    debtor_id?: string;
    billing_id: string;
    description: string;
    amount_cents: number;
    due_date: string;
    installment?: number;
    installment_count?: number;
    payment_snapshot?: PaymentSnapshotColumns;
    state: ChargeState;
    cancelled_at?: string;
    paid_at?: string;
    notify: boolean;
    created_at: string;
    updated_at: string;
  };

  export async function list(db: DbClient, userId: String.UUID, query: { month: string }) {
    const today = Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date());

    const inMonth = {
      due_date: { 
        gte: startOfMonth(query.month),
        lte: endOfMonth(query.month)
      }
    };
  
    const overdue = query.month !== today.slice(0, 7) ? {} : { 
      AND: [
        { 
          state: ChargeState.Pending,
        },
        {
          due_date: {
            lt: startOfMonth(query.month)
          }
        }
      ]
    };

    const { records } = await db.charges.findMany({
      select: {
        id: true,
        description: true,
        installment: true,
        installment_count: true,
        state: true,
        due_date: true,
        amount_cents: true,
        payment_snapshot: true,
        billing: {
          owner_id: true,
          recurrence: true,
          kind: true,
          contact: { id: true, nickname: true, user: { name: true } }
        },
        creditor: {
          name: true,
          email: true,
        },
        debtor: {
          name: true,
          email: true,
          phone: true,
        },
        proofs: {
          state: true,
          kind: true,
        },
      },
      where: {
        AND: [
          {
            OR: [
              { creditor_id: userId },
              { debtor_id: userId }
            ]
          },
          { 
            OR: [
              inMonth,
              overdue
            ]
          }
        ]
      }
    });

    return records.map(({ payment_snapshot, proofs, billing, ...record }) => {
      const { owner_id, ...rest } = billing;

      return {
        ...record,
        has_payment: !!payment_snapshot,
        proof: proofs?.[0] ? { state: proofs[0].state, kind: proofs[0].kind ?? 'file' } : null,
        // The contact is the owner's private agenda entry (their nickname for the person, their row id):
        // the counterpart sits on the other side of the same charge and never receives it.
        billing: { ...rest, contact: owner_id === userId ? (billing.contact ?? null) : null }
      };
    });
  }

  /** The stored proof state as anyone may see it: a reserved slot (`uploading`) is nobody's business yet. */
  export function visibleProofState(proof: Pick<ProofRow, 'state'> | null): ProofState | null {
    switch (proof?.state) {
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
  export function proofOf(proof: ProofRow | null, viewerId: string): ChargeProof | null {
    const state = visibleProofState(proof);
    const kind = proof?.kind ?? ProofKind.File;
    // A declaration has no file, not even one still on its way over it.
    const file = kind === ProofKind.File ? proof?.file : undefined;

    if (!proof || !state || !proof.sent_at || (kind === ProofKind.File && !file)) {
      return null;
    }

    return {
      state,
      kind,
      file: file ? { name: file.name, mime: file.mime, size: file.size } : null,
      sentAt: proof.sent_at,
      reviewedAt: proof.reviewed_at ?? null,
      reason: proof.reason ?? null,
      sentByViewer: proof.sender_user_id === viewerId
    };
  }

  /** What is under review, when anything is. Rows written before declarations existed carry files. */
  export function proofKind(proof: Pick<ProofRow, 'kind'> | null): ProofKind | null {
    return proof ? (proof.kind ?? ProofKind.File) : null;
  }

  /**
   * Whether a payment the paying side declares waits for the other side. The owner of a conta a receber can
   * always answer; the payee of a conta a pagar only with an active account, otherwise the bill settles at once.
   */
  export async function confirmationRequired(db: DbClient, row: Axis): Promise<boolean> {
    if (!ownerPays(row)) {
      return true;
    }

    return (await ContactRepository.counterpartOf(db, creditorOf(row)))?.status === UserStatus.Active;
  }

  /** The columns that say who is who on a charge. */
  export type Axis = Pick<Row, 'owner_id' | 'creditor_id' | 'debtor_id'>;

  /** The owner of the billing behind the charge: every owner power keys on this, never on direction. */
  export function ownerOf(row: Axis): string {
    return row.owner_id;
  }

  /** Who receives; undefined on a conta a pagar without a payee. */
  export function creditorOf(row: Axis): string | undefined {
    return row.creditor_id;
  }

  /** Who pays; undefined on a registro with nobody on the other side. */
  export function debtorOf(row: Axis): string | undefined {
    return row.debtor_id;
  }

  /** The person on the other side of the owner, whichever side of the money they are on; undefined when there is none. */
  export function counterpartId(row: Axis): string | undefined {
    return ownerPays(row) ? creditorOf(row) : debtorOf(row);
  }

  /** A conta a pagar: the owner is the one who pays. */
  export function ownerPays(row: Axis): boolean {
    const debtorId = debtorOf(row);

    return debtorId !== undefined && debtorId === ownerOf(row);
  }

  export function owns(row: Axis, userId: string): boolean {
    return ownerOf(row) === userId;
  }

  /** The billing behind a charge: its type and whether it is a registro. */
  export type SettledBilling = { kind: BillingKind; recurrence: BillingRecurrence };

  export async function settledBilling(db: DbClient, row: Pick<Row, 'billing_id'>): Promise<SettledBilling> {
    const billing = await db.billings.findOne({
      select: { kind: true, recurrence: true },
      where: { id: row.billing_id }
    });

    // A charge always points at a billing; a missing one is corruption, not an empty state.
    if (!billing) {
      throw new HttpNotFoundError();
    }

    return { kind: billingKind(billing), recurrence: billingRecurrence(billing) };
  }

  /** Direction is derived, never stored: whoever sits in `creditor_id` collects, anyone else on the charge pays. */
  export function direction(row: Axis, userId: string): Direction {
    return creditorOf(row) === userId ? Direction.Receivable : Direction.Payable;
  }

  /** Name shown on the other side of a charge, as the viewer knows that person (nickname first). */
  export async function counterpartName(db: DbClient, row: Row, userId: string): Promise<string> {
    if (!owns(row, userId)) {
      return ContactRepository.displayNameFor(db, userId, ownerOf(row));
    }

    const otherId = counterpartId(row);

    // Nobody on the other side: a conta a pagar without a payee is the owner's alone.
    if (!otherId) {
      return 'Você';
    }

    return ContactRepository.displayNameFor(db, userId, otherId);
  }

  /** Photo of the person `counterpartName` names; null on a bill that is the owner's alone. */
  export async function counterpartAvatar(db: DbClient, row: Row, userId: string): Promise<UserAvatar | null> {
    const otherId = owns(row, userId) ? counterpartId(row) : ownerOf(row);

    if (!otherId) {
      return null;
    }

    return (await ContactRepository.counterpartOf(db, otherId))?.avatar ?? null;
  }

  export async function dto(db: DbClient, row: Row, userId: string): Promise<ChargeDetail> {
    const direction = ChargeRepository.direction(row, userId);
    const payment = paymentOf(row);
    const hasPix = !!payment;
    const proof = await currentProof(db, row.id);
    // "Published once, without a key" is a link that exists at all — a revoked one still counts.
    const published = await LinkRepository.everIssued(db, LinkableType.Charge, row.id);
    const record = await settledBilling(db, row);

    return {
      id: row.id,
      description: row.description,
      amount: { amountCents: row.amount_cents, currency: 'BRL' },
      dueDate: row.due_date,
      state: row.state,
      billingId: row.billing_id,
      recurrence: record.recurrence,
      installment: row.installment ?? null,
      installmentCount: row.installment_count ?? null,
      counterpartName: await counterpartName(db, row, userId),
      counterpartAvatar: await counterpartAvatar(db, row, userId),
      counterpartReachable: await reachable(db, row),
      proofState: visibleProofState(proof),
      proofKind: proofKind(proof),
      confirmationRequired: await confirmationRequired(db, row),
      // Only the creditor sees the switch: whoever owes reads every charge the same.
      notify: !owns(row, userId) || row.notify,
      kind: record.kind,
      ownedByViewer: owns(row, userId),
      hasPix,
      direction,
      recipient: await recipientOf(db, row),
      debtorId: counterpartId(row) ?? null,
      // A conta a pagar never publishes a link: the owner already holds the Pix key they typed.
      sharingState:
        row.state !== ChargeState.Pending || ownerPays(row) || record.kind === BillingKind.Record
          ? SharingState.Closed
          : hasPix
            ? SharingState.Ready
            : published
              ? SharingState.LegacyWithoutPix
              : SharingState.PixRequired,
      pix: payment ? { keyType: payment.type, key: payment.value, label: payment.label } : null,
      proof: proofOf(proof, userId),
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
    if (owns(row, actorId) || creditorOf(row) === actorId || debtorOf(row) === actorId) return { row, direction: direction(row, actorId) };
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
      if (!owns(row, creditorId) || ownerPays(row)) throw new HttpForbiddenError();
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
  export async function setNotify(db: DbClient, creditorId: string, id: string, notify: boolean, now = new Date()): Promise<ChargeDetail> {
    return db.transaction(async (tx) => {
      await lockAccountReferences(tx, 'write');

      const row = await tx.charges.findOne({ select: SELECT, where: { id }, lock: true });

      if (!row || !owns(row, creditorId)) {
        throw new HttpNotFoundError();
      }

      if (ownerPays(row)) {
        throw new SilenceUnavailableError();
      }

      if (row.state !== ChargeState.Pending) {
        throw new ChargeClosedError();
      }

      const current = row.notify;

      if (current === notify) {
        return dto(tx, row, creditorId);
      }

      const stamp = now.toISOString();

      await tx.charges.updateOne({ where: { id }, data: { notify, updated_at: stamp } });

      const updated = await tx.charges.findOne({ select: SELECT, where: { id } });

      if (!updated) {
        throw new HttpNotFoundError();
      }

      // The event names are history already written: they keep the old wording on purpose.
      await activity(tx, { actorId: creditorId, row: updated, type: notify ? 'charge.unsilenced' : 'charge.silenced', now: stamp });

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

    await activity(db, { actorId: ownerOf(row), row: updated, type: 'charge.paid', now, payload: { via: 'registered' } });

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
      const proof = await currentProof(tx, id, true);
      const answering = proof?.state === StoredProofState.Pending;
      const declaration = proof?.kind === ProofKind.Declaration;

      if (answering) {
        await tx.proofs.updateOne({
          where: { id: proof!.id },
          data: {
            state: StoredProofState.Accepted,
            reviewed_at: stamp,
            reason: sqlNull,
            // A file still on its way over the answered declaration has nothing left to attach to.
            ...(declaration ? { file: sqlNull, expires_at: sqlNull } : {}),
            updated_at: stamp
          }
        });
      }

      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: {
          state: ChargeState.Paid,
          paid_at: stamp,
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
          payload: { name: declaration ? undefined : proof?.file?.name }
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
      const proof = await currentProof(tx, id, true);

      // A file the settlement had accepted goes back under review; a manual settlement never touched it.
      if (proof?.state === StoredProofState.Accepted) {
        await tx.proofs.updateOne({
          where: { id: proof.id },
          data: { state: StoredProofState.Pending, reviewed_at: sqlNull, reason: sqlNull, updated_at: now }
        });
      }

      const changed = await tx.charges.updateOne({
        select: { id: true },
        where: { id },
        data: {
          state: ChargeState.Pending,
          paid_at: sqlNull,
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
