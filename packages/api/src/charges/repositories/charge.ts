import { Order } from '@ez4/database';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import {
  BillingKind,
  type BillingRecurrence,
  type ChargeDetail,
  ChargeState,
  calendarDate,
  endOfMonth,
  isMonth,
  PaymentLinkState,
  SharingState,
  startOfMonth,
  UserStatus
} from '@receivy/common';
import { ContactRepository } from '../../contacts/repositories/contact';
import { type Person, type PersonRow, personOf } from '../../contacts/utils/person';
import type { DbClient } from '../../database';
import type { ProofRow } from '../../proofs/repositories/proof';
import { LinkRepository } from '../../public/repositories/link';
import { LinkableType } from '../../public/schemas/link';
import {
  counterpartId,
  directionOf,
  ownerOf,
  ownerPays,
  owns,
  paymentLinkOf,
  type PaymentSnapshotColumns,
  paymentOf,
  snapshotDto
} from '../utils/columns';
import { proofKind, proofOf, visibleProofState } from '../utils/proof';

const sqlNull = null as unknown as undefined;

/** The snapshot shaped for a write: `kind` only when the method carries one, the schema never stores `null`. */
function paymentSnapshotWrite(payment: PaymentSnapshotColumns) {
  return {
    provider: payment.provider,
    ...(payment.kind ? { kind: payment.kind } : {}),
    value: payment.value,
    label: payment.label,
    ...(payment.integrationId ? { integrationId: payment.integrationId } : {})
  };
}

/** Everything one charge detail needs from its joins, read in a single query per page. */
type DetailRow = ChargeRepository.Row & {
  billing: { kind: BillingKind; recurrence: BillingRecurrence };
  owner?: PersonRow | null;
  creditor?: PersonRow | null;
  debtor?: PersonRow | null;
  proofs?: ProofRow[] | null;
};

/** The name `userId` shows for a person: the viewer's nickname for them when the agenda has one, else their own. */
function knownAs(person: Person | null, nickname: string | undefined): string {
  return nickname || person?.name || 'Conta excluída';
}

function detailOf(row: DetailRow, userId: string, nicknames: Map<string, string>, published: boolean): ChargeDetail {
  const direction = directionOf(row, userId);
  const payment = paymentOf(row);
  const hasPix = !!payment;
  const proof = row.proofs?.[0] ?? null;
  const owner = personOf(row.owner);
  // The person on the other side of the owner, whichever side of the money they are on.
  const counterpart = personOf(ownerPays(row) ? row.creditor : row.debtor);
  // The person on the other side of the viewer: the counterpart for the owner, the owner for everyone else.
  const other = owns(row, userId) ? counterpart : owner;
  const otherId = owns(row, userId) ? counterpartId(row) : ownerOf(row);

  return {
    id: row.id,
    description: row.description,
    amount: { amountCents: row.amount_cents, currency: 'BRL' },
    dueDate: row.due_date,
    state: row.state,
    billingId: row.billing_id,
    recurrence: row.billing.recurrence,
    installment: row.installment ?? null,
    installmentCount: row.installment_count ?? null,
    // Nobody on the other side: a conta a pagar without a payee is the owner's alone.
    counterpartName: otherId ? knownAs(other, nicknames.get(otherId)) : 'Você',
    counterpartAvatar: other?.avatar ?? null,
    // A reminder needs an address; a bill with nobody on the other side has nobody to remind.
    counterpartReachable: !!counterpart && !!(counterpart.email || counterpart.phone),
    proofState: visibleProofState(proof),
    proofKind: proofKind(proof),
    // The owner of a conta a receber can always answer; the payee of a conta a pagar only with an active account.
    confirmationRequired: !ownerPays(row) || row.creditor?.status === UserStatus.Active,
    // Only the creditor sees the switch: whoever owes reads every charge the same.
    notify: !owns(row, userId) || row.notify,
    kind: row.billing.kind,
    ownedByViewer: owns(row, userId),
    hasPix,
    direction,
    // A registro names its counterpart; a bill that is the owner's alone names the owner.
    recipient: counterpart
      ? { userId: counterpartId(row)!, name: counterpart.name, email: counterpart.email, avatar: counterpart.avatar }
      : { userId: null, name: owner?.name ?? 'Conta excluída', email: null, avatar: owner?.avatar ?? null },
    debtorId: counterpartId(row) ?? null,
    // A conta a pagar never publishes a link: the owner already holds the Pix key they typed.
    sharingState:
      row.state !== ChargeState.Pending || ownerPays(row) || row.billing.kind === BillingKind.Record
        ? SharingState.Closed
        : hasPix
          ? SharingState.Ready
          : published
            ? SharingState.LegacyWithoutPix
            : SharingState.PixRequired,
    payment: snapshotDto(payment),
    paymentLink: paymentLinkOf(row),
    receiptUrl: row.provider_receipt_url ?? null,
    proof: proofOf(proof, userId),
    cancelledAt: row.cancelled_at ?? null,
    paidAt: row.paid_at ?? null,
    createdAt: row.created_at
  };
}

export namespace ChargeRepository {
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
    payment_link_url?: string;
    payment_link_state?: PaymentLinkState;
    provider_link_id?: string;
    provider_transaction_id?: string;
    provider_receipt_url?: string;
    state: ChargeState;
    cancelled_at?: string;
    paid_at?: string;
    notify: boolean;
    created_at: string;
    updated_at: string;
  };

  export async function get(db: DbClient, id: string, lock = false): Promise<Row | null> {
    const row = await db.charges.findOne({
      select: {
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
        payment_link_url: true,
        payment_link_state: true,
        provider_link_id: true,
        provider_transaction_id: true,
        provider_receipt_url: true,
        state: true,
        cancelled_at: true,
        paid_at: true,
        notify: true,
        created_at: true,
        updated_at: true
      },
      where: { id },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  /** A charge with what a notice needs around it: the billing rules, the owner's timezone and whoever has to pay. */
  export type NoticeRow = Row & {
    billing: { kind: BillingKind; reminders?: string; owner: { timezone: string } };
    debtor?: { id: string; name?: string; email?: string; deleted_at?: string };
  };

  export async function forNotice(db: DbClient, id: string): Promise<NoticeRow | null> {
    const row = await db.charges.findOne({
      select: {
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
        payment_link_url: true,
        payment_link_state: true,
        provider_link_id: true,
        provider_transaction_id: true,
        provider_receipt_url: true,
        state: true,
        cancelled_at: true,
        paid_at: true,
        notify: true,
        created_at: true,
        updated_at: true,
        billing: { kind: true, reminders: true, owner: { timezone: true } },
        debtor: { id: true, name: true, email: true, deleted_at: true }
      },
      where: { id }
    });

    return (row as NoticeRow | undefined) ?? null;
  }

  /** Every pending charge due inside the window, with the reminder rules and timezone of its billing. */
  export async function pendingDueBetween(
    db: DbClient,
    from: string,
    to: string
  ): Promise<{ id: string; billing_id: string; due_date: string; notify: boolean; billing: { kind: BillingKind; reminders?: string; owner: { timezone: string } } }[]> {
    const { records } = await db.charges.findMany({
      select: { id: true, billing_id: true, due_date: true, notify: true, billing: { kind: true, reminders: true, owner: { timezone: true } } },
      where: { state: ChargeState.Pending, due_date: { gte: from, lte: to } }
    });

    return records;
  }

  /** The charges of one billing, earliest due first, narrowed by state and due-date bounds when given. */
  export async function byBilling(
    db: DbClient,
    billingId: string,
    options: { state?: ChargeState; dueDate?: string; dueAfter?: string; dueThrough?: string; lock?: boolean } = {}
  ): Promise<Row[]> {
    const { records } = await db.charges.findMany({
      select: {
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
        payment_link_url: true,
        payment_link_state: true,
        provider_link_id: true,
        provider_transaction_id: true,
        provider_receipt_url: true,
        state: true,
        cancelled_at: true,
        paid_at: true,
        notify: true,
        created_at: true,
        updated_at: true
      },
      where: {
        billing_id: billingId,
        ...(options.state ? { state: options.state } : {}),
        ...(options.dueDate ? { due_date: options.dueDate } : {}),
        ...(options.dueAfter && options.dueThrough ? { due_date: { gt: options.dueAfter, lte: options.dueThrough } } : {}),
        ...(options.dueAfter && !options.dueThrough ? { due_date: { gt: options.dueAfter } } : {}),
        ...(options.dueThrough && !options.dueAfter ? { due_date: { lte: options.dueThrough } } : {})
      },
      order: { due_date: Order.Asc, installment: Order.Asc },
      ...(options.lock ? { lock: true } : {})
    });

    return records;
  }

  /** Every charge between two people, whichever of them collects, by id. */
  export async function between(db: DbClient, userId: string, otherId: string): Promise<Row[]> {
    const { records } = await db.charges.findMany({
      select: {
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
        payment_link_url: true,
        payment_link_state: true,
        provider_link_id: true,
        provider_transaction_id: true,
        provider_receipt_url: true,
        state: true,
        cancelled_at: true,
        paid_at: true,
        notify: true,
        created_at: true,
        updated_at: true
      },
      where: {
        OR: [
          { creditor_id: userId, debtor_id: otherId },
          { creditor_id: otherId, debtor_id: userId }
        ]
      },
      order: { id: Order.Asc }
    });

    return records;
  }

  /**
   * The viewer's month in one query: the charges due in it plus, on the current month only, the pending ones
   * still overdue from earlier months. Every name, proof and billing fact the feed shows rides on the joins.
   */
  export async function list(db: DbClient, userId: string, query: { month: string }) {
    if (!isMonth(query.month)) {
      throw new HttpBadRequestError(`Mês inválido: ${query.month}.`);
    }

    const viewer = await db.users.findOne({ select: { timezone: true }, where: { id: userId } });

    if (!viewer) {
      throw new HttpNotFoundError();
    }

    // "Current month" is the viewer's, not the server's: the overdue carry-over follows their calendar.
    const today = calendarDate(new Date(), viewer.timezone);
    const inMonth = { due_date: { gte: startOfMonth(query.month), lte: endOfMonth(query.month) } };
    const overdue = query.month !== today.slice(0, 7) ? {} : { AND: [{ state: ChargeState.Pending }, { due_date: { lt: startOfMonth(query.month) } }] };
    const { records } = await db.charges.findMany({
      select: {
        id: true,
        billing_id: true,
        creditor_id: true,
        debtor_id: true,
        description: true,
        installment: true,
        installment_count: true,
        state: true,
        due_date: true,
        payment_snapshot: true,
        amount_cents: true,
        notify: true,
        billing: {
          owner_id: true,
          recurrence: true,
          kind: true,
          contact: { id: true, nickname: true, user: { name: true } }
        },
        creditor: { name: true, email: true, phone: true, status: true },
        debtor: { name: true, email: true, phone: true, status: true },
        proofs: { state: true, kind: true }
      },
      where: {
        AND: [{ OR: [{ creditor_id: userId }, { debtor_id: userId }] }, { OR: [inMonth, overdue] }]
      }
    });

    return records;
  }

  export async function insert(
    db: DbClient,
    input: {
      ownerId: string;
      creditorId?: string;
      debtorId?: string;
      billingId: string;
      description: string;
      amountCents: number;
      dueDate: string;
      installment?: number;
      installmentCount?: number;
      payment: PaymentSnapshotColumns | null;
      notify: boolean;
      now: string;
    }
  ): Promise<Row> {
    return db.charges.insertOne({
      select: {
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
        payment_link_url: true,
        payment_link_state: true,
        provider_link_id: true,
        provider_transaction_id: true,
        provider_receipt_url: true,
        state: true,
        cancelled_at: true,
        paid_at: true,
        notify: true,
        created_at: true,
        updated_at: true
      },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        ...(input.creditorId ? { creditor: { id: input.creditorId } } : {}),
        ...(input.debtorId ? { debtor: { id: input.debtorId } } : {}),
        billing: { id: input.billingId },
        description: input.description,
        amount_cents: input.amountCents,
        due_date: input.dueDate,
        ...(input.installment !== undefined && input.installmentCount !== undefined
          ? { installment: input.installment, installment_count: input.installmentCount }
          : {}),
        ...(input.payment ? { payment_snapshot: paymentSnapshotWrite(input.payment) } : {}),
        state: ChargeState.Pending,
        notify: input.notify,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  /** What the billing cards count: every charge of the page's billings with the state of its proof. */
  export async function summaryOf(db: DbClient, billingIds: string[]) {
    if (!billingIds.length) {
      return [];
    }

    const { records } = await db.charges.findMany({
      select: { id: true, billing_id: true, state: true, due_date: true, proofs: { state: true } },
      where: { billing_id: { isIn: billingIds } }
    });

    return records;
  }

  /** A month rewrite: the amount, description, due date and key of a pending charge follow the billing edit. */
  export async function edit(
    db: DbClient,
    id: string,
    input: { description: string; amountCents: number; dueDate?: string; payment?: PaymentSnapshotColumns | null; now: string }
  ): Promise<void> {
    await db.charges.updateOne({
      where: { id },
      data: {
        description: input.description,
        amount_cents: input.amountCents,
        ...(input.dueDate ? { due_date: input.dueDate } : {}),
        ...(input.payment !== undefined ? { payment_snapshot: input.payment ? paymentSnapshotWrite(input.payment) : sqlNull } : {}),
        updated_at: input.now
      }
    });
  }

  /** The earliest pending charge of a billing that `debtorId` has to pay, if any. */
  export async function nearestPending(db: DbClient, billingId: string, debtorId: string): Promise<string | null> {
    const { records } = await db.charges.findMany({
      select: { id: true },
      where: { billing_id: billingId, debtor_id: debtorId, state: ChargeState.Pending },
      order: { due_date: Order.Asc },
      take: 1
    });

    return records[0]?.id ?? null;
  }

  /** A split reshaped under the charge: only its amount moves. */
  export async function setAmount(db: DbClient, id: string, amountCents: number, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { amount_cents: amountCents, updated_at: now } });
  }

  /** Every charge the person is on, on any side, plus the given ids: an erasure reaches them all under lock. */
  export async function idsTouching(db: DbClient, userId: string, extraIds: string[], lock = false): Promise<string[]> {
    const { records } = await db.charges.findMany({
      select: { id: true },
      where: {
        OR: [
          { owner_id: userId },
          { creditor_id: userId },
          { debtor_id: userId },
          // An empty list would be a where clause with nothing in it: the arm only goes in when there is one.
          ...(extraIds.length ? [{ id: { isIn: extraIds } }] : [])
        ]
      },
      ...(lock ? { lock: true } : {})
    });

    return records.map((row) => row.id).sort((a, b) => a.localeCompare(b));
  }

  export async function hasAny(db: DbClient, billingId: string): Promise<boolean> {
    return !!(await db.charges.count({ where: { billing_id: billingId } }));
  }

  /** The `notify` of every pending charge the person has to pay on a billing. */
  export async function pendingNotifyFlags(db: DbClient, billingId: string, debtorId: string): Promise<boolean[]> {
    const { records } = await db.charges.findMany({ select: { notify: true }, where: { billing_id: billingId, debtor_id: debtorId, state: ChargeState.Pending } });

    return records.map((row) => row.notify);
  }

  /** A participant's switch lands on their pending charges of the billing; paid and cancelled ones keep theirs. */
  export async function setPendingNotify(db: DbClient, billingId: string, debtorId: string, notify: boolean, now: string): Promise<void> {
    await db.charges.updateMany({ where: { billing_id: billingId, debtor_id: debtorId, state: ChargeState.Pending }, data: { notify, updated_at: now } });
  }

  /** The key the charge was paid through is gone with its creditor. */
  export async function clearPayment(db: DbClient, id: string, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { payment_snapshot: sqlNull, updated_at: now } });
  }

  export async function markPaid(db: DbClient, id: string, paidAt: string, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { state: ChargeState.Paid, paid_at: paidAt, updated_at: now } });
  }

  export async function markCancelled(db: DbClient, id: string, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { state: ChargeState.Cancelled, cancelled_at: now, updated_at: now } });
  }

  /** Back to pending, with no settlement left on the row. */
  export async function markPending(db: DbClient, id: string, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { state: ChargeState.Pending, paid_at: sqlNull, updated_at: now } });
  }

  export async function setNotify(db: DbClient, id: string, notify: boolean, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { notify, updated_at: now } });
  }

  /** Freezes the key the charge is paid through; published once, it never changes again. */
  export async function setPayment(db: DbClient, id: string, payment: PaymentSnapshotColumns, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { payment_snapshot: paymentSnapshotWrite(payment), updated_at: now } });
  }

  /** Where the checkout link stands; `url` only comes with `ready`. */
  export async function setPaymentLink(db: DbClient, id: string, input: { url?: string; linkId?: string; state: PaymentLinkState }, now: string): Promise<void> {
    await db.charges.updateOne({
      where: { id },
      data: {
        payment_link_state: input.state,
        ...(input.url ? { payment_link_url: input.url } : {}),
        ...(input.linkId ? { provider_link_id: input.linkId } : {}),
        updated_at: now
      }
    });
  }

  /** Settled by the provider: the transaction id is what makes a replayed webhook a no-op. */
  export async function markPaidByProvider(db: DbClient, id: string, input: { paidAt: string; transactionId: string; receiptUrl?: string }, now: string): Promise<void> {
    await db.charges.updateOne({
      where: { id },
      data: {
        state: ChargeState.Paid,
        paid_at: input.paidAt,
        provider_transaction_id: input.transactionId,
        ...(input.receiptUrl ? { provider_receipt_url: input.receiptUrl } : {}),
        updated_at: now
      }
    });
  }

  export async function touch(db: DbClient, id: string, now: string): Promise<void> {
    await db.charges.updateOne({ where: { id }, data: { updated_at: now } });
  }

  /** Every charge naming `from` on either side now names `to`; the owner column never moves. */
  export async function reassignPerson(db: DbClient, from: string, to: string, now: string): Promise<void> {
    await db.charges.updateMany({ where: { debtor_id: from }, data: { debtor: { id: to }, updated_at: now } });
    await db.charges.updateMany({ where: { creditor_id: from }, data: { creditor: { id: to }, updated_at: now } });
  }

  /**
   * The details of many charges as `userId` sees them, in the order given: one read for the rows and their
   * joins, one for the viewer's nicknames, one for the links ever issued. Never one query per row.
   */
  export async function dtos(db: DbClient, rows: Pick<Row, 'id'>[], userId: string): Promise<ChargeDetail[]> {
    if (!rows.length) {
      return [];
    }

    const ids = rows.map((row) => row.id);

    const { records } = await db.charges.findMany({
      select: {
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
        payment_link_url: true,
        payment_link_state: true,
        provider_link_id: true,
        provider_transaction_id: true,
        provider_receipt_url: true,
        state: true,
        cancelled_at: true,
        paid_at: true,
        notify: true,
        created_at: true,
        updated_at: true,
        billing: { kind: true, recurrence: true },
        owner: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true },
        creditor: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true },
        debtor: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true },
        proofs: {
          id: true,
          charge_id: true,
          state: true,
          kind: true,
          file: true,
          sender_user_id: true,
          actor_hash: true,
          expires_at: true,
          sent_at: true,
          reviewed_at: true,
          reason: true,
          created_at: true,
          updated_at: true
        }
      },
      where: { id: { isIn: ids } }
    });
    const byId = new Map(records.map((record) => [record.id, record as DetailRow]));
    const others = [...new Set(records.map((row) => (owns(row, userId) ? counterpartId(row) : ownerOf(row))).filter(Boolean))] as string[];
    const nicknames = await ContactRepository.nicknames(db, userId, others);
    // "Published once, without a key" is a link that exists at all — a revoked one still counts.
    const published = await LinkRepository.issuedFor(db, LinkableType.Charge, ids);

    return ids.flatMap((id) => {
      const row = byId.get(id);

      return row ? [detailOf(row, userId, nicknames, published.has(id))] : [];
    });
  }

  export async function dto(db: DbClient, row: Pick<Row, 'id'>, userId: string): Promise<ChargeDetail> {
    const [detail] = await dtos(db, [row], userId);

    if (!detail) {
      throw new HttpNotFoundError();
    }

    return detail;
  }
}
