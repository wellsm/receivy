import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import {
  BillingType,
  ChargePayer,
  ChargeState,
  type ChargeSummary,
  type ContactLedger,
  Direction,
  FeedStatus,
  type TimelineItem,
  type TimelinePage
} from '@receivy/common';
import { BillingRepository } from '../../billings/repositories/billing';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { TimelineOverflowError } from '../errors';

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

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
  return { OR: [{ creditor_id: userId }, { debtor_user_id: userId }] };
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
function directionWhere(userId: string, direction: Direction) {
  const ownerSide = { creditor_id: userId };
  const counterpartSide = { debtor_user_id: userId };
  const contactPays = { OR: [{ payer: ChargePayer.Person }, { payer: { isNull: true } }] };
  const ownerPays = { payer: ChargePayer.Owner };

  return direction === Direction.Receivable
    ? { OR: [{ AND: [ownerSide, contactPays] }, { AND: [counterpartSide, ownerPays] }] }
    : { OR: [{ AND: [ownerSide, ownerPays] }, { AND: [counterpartSide, contactPays] }] };
}

/** `overdue` is not stored: it is a pending charge the due date already passed. */
function statusWhere(status: TimelineRepository.Status, today: string) {
  if (status === FeedStatus.Overdue) {
    return { AND: [{ state: ChargeState.Pending }, { due_date: { lt: today } }] };
  }

  return { state: status };
}

function visibleWhere(userId: string, filters: TimelineRepository.Filters, withCursor: boolean, today: string) {
  const directions = filters.direction ?? [];
  const statuses = filters.status ?? [];
  const types = filters.type ?? [];
  const access = directions.length ? { OR: directions.map((value) => directionWhere(userId, value)) } : accessWhere(userId);
  const cursor = withCursor ? cursorDate(filters.cursor) : undefined;
  return {
    AND: [
      access,
      ...(statuses.length ? [{ OR: statuses.map((status) => statusWhere(status, today)) }] : []),
      ...(types.length ? [{ billing_type: { isIn: types } }] : []),
      ...(filters.from ? [{ due_date: { gte: filters.from } }] : []),
      ...(filters.to ? [{ due_date: { lte: filters.to } }] : []),
      ...(cursor ? [{ OR: [{ due_date: { gt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { gt: cursor.id } }] }] : [])
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
function visibleProofState(row: ChargeRepository.Row): ChargeSummary['proofState'] {
  return ChargeRepository.visibleProofState(row);
}

export namespace TimelineRepository {
  export type Status = ChargeState | FeedStatus.Overdue;

  /** Each list is an "any of"; an empty one leaves that group unfiltered. */
  export type Filters = {
    cursor?: string;
    direction?: Direction[];
    status?: Status[];
    type?: BillingType[];
    from?: string;
    to?: string;
  };

  export async function get(db: DbClient, userId: string, filters: Filters): Promise<TimelinePage> {
    const user = await actor(db, userId);
    const today = localDate(user.timezone);
    const allQuery = await db.charges.findMany({
      select: ChargeRepository.SELECT,
      where: visibleWhere(userId, filters, false, today)
    });
    const all = allQuery.records;
    const active = all.filter((row) => row.state === ChargeState.Pending);
    const directions = filters.direction ?? [];
    const statuses = filters.status ?? [];
    const types = filters.type ?? [];
    // A preview is a future occurrence: it can only ever be pending, and only for a recurring billing.
    const projected =
      (!types.length || types.includes(BillingType.Indefinite)) && (!statuses.length || statuses.includes(ChargeState.Pending))
        ? (await BillingRepository.indefinitePreviews(db, userId)).filter(
            (preview) =>
              (!directions.length || directions.includes(preview.direction)) &&
              (!filters.from || preview.occurrenceDate >= filters.from) &&
              (!filters.to || preview.occurrenceDate <= filters.to)
          )
        : [];
    const primary = [
      ...all.map((row) => ({ dueDate: row.due_date, id: row.id, row, preview: undefined })),
      ...projected.map((preview) => ({
        dueDate: preview.occurrenceDate,
        id: `billing:${preview.billingId}:${preview.occurrenceDate}`,
        row: undefined,
        preview
      }))
    ].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const cursor = cursorDate(filters.cursor);
    const remaining = primary.filter(
      (item) => !cursor || item.dueDate > cursor.dueDate || (item.dueDate === cursor.dueDate && item.id > cursor.id)
    );
    const primaryPage = remaining.slice(0, 50);
    const page = primaryPage.flatMap((item) => (item.row ? [item.row] : []));
    const next = remaining.length > 50 ? primaryPage.at(-1) : undefined;
    // Group financial history with its charge page, preserving charge-cursor pagination.
    const history: TimelineItem[] = [];
    const counterparts = new Map<string, string>();
    const proofStates = new Map<string, ChargeSummary['proofState']>();
    for (const row of page) {
      const direction = directionFor(row, userId);
      const proofState = visibleProofState(row);
      counterparts.set(row.id, await ChargeRepository.counterpartName(db, row, userId));
      proofStates.set(row.id, proofState);
      // The debtor only sees the file they sent themselves; the creditor sees whatever is attached.
      if (proofState && row.proof_sent_at && (direction === Direction.Receivable || row.proof_sender_user_id === userId))
        history.push({
          kind: 'proof',
          direction,
          proof: { chargeId: row.id, state: proofState, sentAt: row.proof_sent_at }
        });
      if (row.state === ChargeState.Paid && row.paid_at)
        history.push({ kind: 'payment', direction, payment: { chargeId: row.id, amount: money(row.amount_cents), paidAt: row.paid_at } });
    }
    const proofsToReview = active.filter(
      (row) => directionFor(row, userId) === Direction.Receivable && row.proof_state === StoredProofState.Pending
    ).length;
    return {
      items: [
        ...primaryPage.map(
          (item): TimelineItem =>
            item.preview
              ? { kind: 'billing_preview', direction: item.preview.direction, preview: item.preview }
              : {
                  kind: 'charge',
                  direction: directionFor(item.row!, userId),
                  charge: {
                    id: item.row!.id,
                    description: item.row!.description,
                    amount: money(item.row!.amount_cents),
                    dueDate: item.row!.due_date,
                    state: item.row!.state,
                    billingId: item.row!.billing_id,
                    billingType: item.row!.billing_type,
                    installment: item.row!.installment ?? null,
                    installmentCount: item.row!.installment_count ?? null,
                    counterpartName: counterparts.get(item.row!.id) ?? '',
                    proofState: proofStates.get(item.row!.id) ?? null,
                    payer: ChargeRepository.payer(item.row!),
                    ownedByViewer: ChargeRepository.owns(item.row!, userId),
                    hasPix: !!item.row!.pix_key_snapshot && !!item.row!.pix_key_type_snapshot
                  }
                }
        ),
        ...history
      ],
      summary: {
        receivable: money(sum(active.filter((row) => directionFor(row, userId) === Direction.Receivable))),
        payable: money(sum(active.filter((row) => directionFor(row, userId) === Direction.Payable))),
        overdue: money(sum(active.filter((row) => row.state === ChargeState.Pending && row.due_date < today))),
        pending: money(sum(active.filter((row) => row.state === ChargeState.Pending))),
        proofsToReview,
        receivableCount: active.filter((row) => directionFor(row, userId) === Direction.Receivable).length,
        payableCount: active.filter((row) => directionFor(row, userId) === Direction.Payable).length
      },
      nextCursor: next ? Buffer.from(JSON.stringify({ dueDate: next.dueDate, id: next.id })).toString('base64url') : null
    };
  }

  /** Every charge between the viewer and one contact, whichever of them owns the billing. */
  export async function contactLedger(db: DbClient, userId: string, contactId: string, cursor?: string): Promise<ContactLedger> {
    const { userId: otherId } = await ContactRepository.user(db, userId, contactId);
    const baseWhere = {
      OR: [
        { creditor_id: userId, debtor_user_id: otherId },
        { creditor_id: otherId, debtor_user_id: userId }
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
