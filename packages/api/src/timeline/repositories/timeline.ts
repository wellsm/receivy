import { Order } from '@ez4/database';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import {
  type BillingRecurrence,
  ChargeState,
  type ChargeSummary,
  type ContactLedger,
  Direction,
  endOfMonth,
  FeedStatus,
  type TimelineItem,
  type TimelinePage
} from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { type ProofRow, proofsByCharge } from '../../proofs/repositories/proof-row';
import { StoredProofState } from '../../charges/schemas/charge';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { TimelineOverflowError } from '../errors';

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function money(amountCents: bigint | number) {
  const exact =
    typeof amountCents === 'bigint' ? amountCents : Number.isSafeInteger(amountCents) ? BigInt(amountCents) : MAX_SAFE_CENTS + 1n;
  if (exact < -MAX_SAFE_CENTS || exact > MAX_SAFE_CENTS) {
    throw new TimelineOverflowError();
  }
  return { amountCents: Number(exact), currency: 'BRL' as const };
}

function sum(rows: ChargeRepository.Row[]): bigint {
  return rows.reduce((total, row) => total + BigInt(row.amount_cents), 0n);
}

async function actor(db: DbClient, userId: string) {
  const user = await db.users.findOne({ select: { timezone: true }, where: { id: userId } });
  if (!user) throw new HttpNotFoundError();
  return user;
}

function accessWhere(userId: string) {
  return { OR: [{ owner_id: userId }, { creditor_id: userId }, { debtor_id: userId }] };
}

function cursorDate(cursor?: string): { dueDate: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { dueDate?: unknown; id?: unknown };
    return typeof parsed.dueDate === 'string' && typeof parsed.id === 'string' ? { dueDate: parsed.dueDate, id: parsed.id } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Direction is derived from which side of the row the viewer sits on and who pays: the owner of a
 * conta a receber collects and the owner of a conta a pagar pays; the counterpart is the inverse.
 */
function directionWhere(userId: string, direction: Direction): { creditor_id?: string; debtor_id?: string } {
  return direction === Direction.Receivable ? { creditor_id: userId } : { debtor_id: userId };
}

/** `overdue` is not stored: it is a pending charge the due date already passed. */
function statusWhere(status: TimelineRepository.Status, today: string) {
  if (status === FeedStatus.Overdue) {
    return { AND: [{ state: ChargeState.Pending }, { due_date: { lt: today } }] };
  }

  return { state: status };
}

/** `filters.month` if given and well-formed, else the current month (same "today" the feed already uses). */
function resolveMonth(month: string | undefined, today: string): string {
  if (!month) {
    return today.slice(0, 7);
  }

  if (!MONTH_FORMAT.test(month)) {
    throw new HttpBadRequestError(`Mês inválido: ${month}.`);
  }

  return month;
}

/**
 * The selected month's due dates, plus — only when that month is the current one — pending charges
 * still overdue from an earlier month. Every other filter narrows inside this set.
 */
function itemSetWhere(month: string, today: string) {
  const start = `${month}-01`;
  const inMonth = { due_date: { gte: start, lte: endOfMonth(start) } };

  if (month !== today.slice(0, 7)) {
    return inMonth;
  }

  return { OR: [inMonth, { AND: [{ state: ChargeState.Pending }, { due_date: { lt: start } }] }] };
}

function visibleWhere(userId: string, filters: TimelineRepository.Filters, withCursor: boolean, today: string, month: string) {
  const directions = filters.direction ?? [];
  const statuses = filters.status ?? [];
  const types = filters.recurrence ?? [];
  const access = directions.length ? { OR: directions.map((value) => directionWhere(userId, value)) } : accessWhere(userId);
  const cursor = withCursor ? cursorDate(filters.cursor) : undefined;
  return {
    AND: [
      access,
      ...(statuses.length ? [{ OR: statuses.map((status) => statusWhere(status, today)) }] : []),
      // The type lives on the billing: EZ4 turns a relation filter into a correlated EXISTS on its primary key.
      ...(types.length ? [{ billing: { recurrence: { isIn: types } } }] : []),
      ...(filters.from ? [{ due_date: { gte: filters.from } }] : []),
      ...(filters.to ? [{ due_date: { lte: filters.to } }] : []),
      itemSetWhere(month, today),
      ...(cursor ? [{ OR: [{ due_date: { lt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { gt: cursor.id } }] }] : [])
    ]
  };
}

function localDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function directionFor(row: ChargeRepository.Row, userId: string): Direction {
  return ChargeRepository.direction(row, userId);
}

/** What the feed shows about the attached file: a reserved slot is nobody's business yet. */
function visibleProofState(proof: ProofRow | null): ChargeSummary['proofState'] {
  return ChargeRepository.visibleProofState(proof);
}

export namespace TimelineRepository {
  export type Status = ChargeState | FeedStatus.Overdue;

  /** Each list is an "any of"; an empty one leaves that group unfiltered. */
  export type Filters = {
    cursor?: string;
    direction?: Direction[];
    status?: Status[];
    recurrence?: BillingRecurrence[];
    from?: string;
    to?: string;
    /** `YYYY-MM`; defaults to the current month. */
    month?: string;
  };

  export async function get(db: DbClient, userId: string, filters: Filters): Promise<TimelinePage> {
    const user = await actor(db, userId);
    const today = localDate(user.timezone);
    const month = resolveMonth(filters.month, today);
    const allQuery = await db.charges.findMany({
      select: ChargeRepository.SELECT,
      where: visibleWhere(userId, filters, false, today, month)
    });
    const all = allQuery.records;
    const active = all.filter((row) => row.state === ChargeState.Pending);
    const cursor = cursorDate(filters.cursor);
    // Latest due date first; within a day the id keeps the order stable, and the cursor follows the same order.
    const remaining = all
      .filter((row) => !cursor || row.due_date < cursor.dueDate || (row.due_date === cursor.dueDate && row.id > cursor.id))
      .sort((a, b) => (a.due_date > b.due_date ? -1 : a.due_date < b.due_date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const page = remaining.slice(0, 50);
    const next = remaining.length > 50 ? page.at(-1) : undefined;
    const items: TimelineItem[] = [];
    // One query for the whole page: the proof moved to its own table and this list must not go row by row.
    const proofs = await proofsByCharge(db, [...new Set([...page.map((row) => row.id), ...active.map((row) => row.id)])]);

    for (const row of page) {
      const record = await ChargeRepository.settledBilling(db, row);

      items.push({
        kind: 'charge',
        direction: directionFor(row, userId),
        charge: {
          id: row.id,
          description: row.description,
          amount: money(row.amount_cents),
          dueDate: row.due_date,
          state: row.state,
          billingId: row.billing_id,
          recurrence: record.recurrence,
          installment: row.installment ?? null,
          installmentCount: row.installment_count ?? null,
          counterpartName: await ChargeRepository.counterpartName(db, row, userId),
          counterpartAvatar: await ChargeRepository.counterpartAvatar(db, row, userId),
          proofState: visibleProofState(proofs.get(row.id) ?? null),
          ownedByViewer: ChargeRepository.owns(row, userId),
          hasPix: !!ChargeRepository.paymentOf(row),
          proofKind: ChargeRepository.proofKind(proofs.get(row.id) ?? null),
          confirmationRequired: await ChargeRepository.confirmationRequired(db, row),
          notify: !ChargeRepository.owns(row, userId) || row.notify,
          kind: record.kind,
          // Block 9: the billing no longer names a counterpart label of its own.
          counterpartLabel: null
        }
      });
    }

    const proofsToReview = active.filter(
      (row) => directionFor(row, userId) === Direction.Receivable && proofs.get(row.id)?.state === StoredProofState.Pending
    ).length;
    // Paid rows never carry over from an earlier month, so `all` already bounds these to the selected month.
    const settled = all.filter((row) => row.state === ChargeState.Paid);
    return {
      items,
      month,
      summary: {
        receivable: money(sum(active.filter((row) => directionFor(row, userId) === Direction.Receivable))),
        payable: money(sum(active.filter((row) => directionFor(row, userId) === Direction.Payable))),
        overdue: money(sum(active.filter((row) => row.state === ChargeState.Pending && row.due_date < today))),
        pending: money(sum(active.filter((row) => row.state === ChargeState.Pending))),
        proofsToReview,
        receivableCount: active.filter((row) => directionFor(row, userId) === Direction.Receivable).length,
        payableCount: active.filter((row) => directionFor(row, userId) === Direction.Payable).length,
        receivedTotal: money(sum(settled.filter((row) => directionFor(row, userId) === Direction.Receivable))),
        paidTotal: money(sum(settled.filter((row) => directionFor(row, userId) === Direction.Payable)))
      },
      nextCursor: next ? Buffer.from(JSON.stringify({ dueDate: next.due_date, id: next.id })).toString('base64url') : null
    };
  }

  /** Every charge between the viewer and one contact, whichever of them owns the billing. */
  export async function contactLedger(db: DbClient, userId: string, contactId: string, cursor?: string): Promise<ContactLedger> {
    const { userId: otherId } = await ContactRepository.user(db, userId, contactId);
    const baseWhere = {
      OR: [
        { creditor_id: userId, debtor_id: otherId },
        { creditor_id: otherId, debtor_id: userId }
      ]
    };
    const pageWhere = { AND: [baseWhere, ...(cursor ? [{ id: { gt: cursor } }] : [])] };
    const result = await db.charges.findMany({ select: ChargeRepository.SELECT, where: pageWhere, order: { id: Order.Asc }, take: 51 });
    const page = result.records.slice(0, 50);
    const all = await db.charges.findMany({ select: ChargeRepository.SELECT, where: baseWhere });
    const receivable = sum(
      all.records.filter((row) => directionFor(row, userId) === Direction.Receivable && row.state === ChargeState.Pending)
    );
    const payable = sum(all.records.filter((row) => directionFor(row, userId) === Direction.Payable && row.state === ChargeState.Pending));
    return {
      contactId,
      contact: await ContactRepository.get(db, userId, contactId),
      balance: money(receivable - payable),
      receivable: money(receivable),
      payable: money(payable),
      charges: await Promise.all(page.map((row) => ChargeRepository.dto(db, row, userId))),
      nextCursor: result.records.length > 50 ? page.at(-1)!.id : null
    };
  }
}
