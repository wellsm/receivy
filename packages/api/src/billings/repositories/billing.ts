import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import {
  addCalendarDays,
  type BillingAllocation,
  BillingCategory,
  type BillingDetail,
  BillingDueRule,
  type BillingFrequency,
  type BillingGuest,
  type BillingInput,
  type BillingPatch,
  type BillingPayee,
  type BillingPreview,
  type BillingReminder,
  type BillingSplit,
  BillingState,
  type BillingSummary,
  type BillingsPage,
  BillingType,
  billingDates,
  billingDueDates,
  ChargePayer,
  ChargeState,
  calendarDate,
  Direction,
  EditScope,
  endOfMonth,
  materializationDate,
  materializationHorizon,
  normalizeBillingInput,
  PendingChargesAction,
  type PixKeyType,
  type PixSnapshot,
  planBillingCharges,
  resolveBillingSplit,
  SplitMode,
  SplitPartKind,
  UserStatus
} from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import {
  lockOwner,
  type PayableMaterialization,
  persistChargePlan,
  prepareChargeMaterialization
} from '../../charges/services/materialize';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { activeInvite, type InviteLinkContext } from '../../invites/services/links';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { AvatarRepository } from '../../users/repositories/avatar';
import {
  BillingEndedError,
  BillingNotPausableError,
  BillingPreviewUnavailableError,
  BillingSnapshotLockedError,
  EditScopeNotRecurringError,
  IdempotencyMismatchError,
  PayableHasNoSplitError,
  PendingChargesWithoutStateError,
  ReceivableHasNoPayeeError
} from '../errors';
import { BillingGuestState } from '../schemas/billing-guest';
import { type MonthCharge, monthChanges } from '../services/month-scope';
import { effectiveReminders, parseReminders } from '../services/reminders';
import { billingRequestFingerprint } from '../services/request';

function billingPix(row: Pick<BillingRepository.Row, 'pix_key_type' | 'pix_key' | 'pix_label'>): PixSnapshot | null {
  return row.pix_key_type && row.pix_key ? { keyType: row.pix_key_type, key: row.pix_key, label: row.pix_label ?? 'Pix' } : null;
}

/** The contact who receives a conta a pagar; archived contacts still name it, the bill stays theirs. */
async function payeeOf(db: DbClient, row: Pick<BillingRepository.Row, 'payee_user_id'>): Promise<BillingPayee | null> {
  if (!row.payee_user_id) {
    return null;
  }

  const person = await ContactRepository.counterpartOf(db, row.payee_user_id);

  return person ? { userId: row.payee_user_id, name: person.name, avatar: person.avatar } : null;
}

/** What `prepareChargeMaterialization` needs to know about a conta a pagar, or undefined for a conta a receber. */
function payableOf(
  row: Pick<BillingRepository.Row, 'direction' | 'pix_key_type' | 'pix_key' | 'pix_label'>
): PayableMaterialization | undefined {
  return BillingRepository.direction(row) === Direction.Payable ? { payer: ChargePayer.Owner, pix: billingPix(row) } : undefined;
}

/** Card counters a list entry carries beyond the stored billing row. */
type BillingCounters = {
  participantCount: number;
  chargeCount: number;
  paidCount: number;
  proofsPending: number;
  shareChargeId: string | null;
};

// EZ4 0.52 optional-field typings omit SQL NULL; explicit null clears old values.
const sqlNull = null as unknown as undefined;
const PAGE_SIZE = 50;
const SEARCH_LIMIT = 80;
const PREVIEW_DAYS = 90;

async function billingRow(db: DbClient, ownerId: string, id: string, lock = false): Promise<BillingRepository.Row> {
  const row = await db.billings.findOne({ select: BillingRepository.SELECT, where: { id, owner_id: ownerId }, lock });

  if (!row) {
    throw new HttpNotFoundError();
  }

  return row;
}

function calendarRule(row: BillingRepository.Row) {
  return { frequency: row.frequency!, startDate: row.start_date, endDate: row.end_date, dueRule: row.due_rule };
}

async function previewsFor(db: DbClient, row: BillingRepository.Row, reminders: BillingReminder[], now: Date): Promise<BillingPreview[]> {
  if (row.type !== BillingType.Indefinite || row.state !== BillingState.Active) {
    return [];
  }

  const today = calendarDate(now, row.timezone);
  const cursor = row.processed_through ?? addCalendarDays(today, -1);
  const existing = (
    await db.charges.findMany({ select: { due_date: true }, where: { billing_id: row.id, due_date: { gte: today } } })
  ).records.map((charge) => charge.due_date);
  const direction = BillingRepository.direction(row);
  // A conta a pagar is owed in full by the owner; a conta a receber only projects what contacts owe.
  const projected =
    direction === Direction.Payable
      ? row.total_cents
      : resolveBillingSplit(row.total_cents, (await BillingRepository.splitFor(db, row.id)).split)
          .filter((allocation) => allocation.kind === SplitPartKind.User)
          .reduce((sum, allocation) => sum + allocation.amountCents, 0);

  return billingDates(calendarRule(row), today, addCalendarDays(today, PREVIEW_DAYS))
    .filter((date) => !existing.includes(date) && date > cursor)
    .map((occurrenceDate) => ({
      billingId: row.id,
      direction,
      description: row.description,
      amount: { amountCents: projected, currency: 'BRL' as const },
      occurrenceDate,
      materializationDate: materializationDate(occurrenceDate, reminders)
    }));
}

async function nextMaterialization(db: DbClient, row: BillingRepository.Row, reminders: BillingReminder[]): Promise<string | null> {
  if (row.type !== BillingType.Indefinite || row.state !== BillingState.Active) {
    return null;
  }

  const cursor = row.processed_through ?? row.start_date;
  const existing = (
    await db.charges.findMany({ select: { due_date: true }, where: { billing_id: row.id, due_date: { gt: cursor } } })
  ).records.map((charge) => charge.due_date);
  const next = billingDates(calendarRule(row), addCalendarDays(cursor, 1), '9999-12-31', existing.length + 1).find(
    (date) => !existing.includes(date)
  );

  return next ? materializationDate(next, reminders) : null;
}

function summary(
  row: BillingRepository.Row,
  nextDueDate: string | null,
  counters: BillingCounters,
  installmentCount: number | undefined,
  payee: BillingPayee | null
): BillingSummary {
  return {
    id: row.id,
    direction: BillingRepository.direction(row),
    payeeName: payee?.name ?? null,
    type: row.type,
    frequency: row.frequency,
    description: row.description,
    total: { amountCents: row.total_cents, currency: row.currency },
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule ?? BillingDueRule.Fixed,
    state: row.state,
    installmentCount,
    nextDueDate,
    createdAt: row.created_at,
    category: row.category,
    ...counters
  };
}

/** The earliest pending charge, overdue included; it is what `nextDueDate` reports. */
async function earliestPendingCharge(db: DbClient, id: string): Promise<{ id: string; due_date: string } | undefined> {
  const rows = await db.charges.findMany({
    select: { id: true, due_date: true },
    where: { billing_id: id, state: ChargeState.Pending },
    order: { due_date: Order.Asc },
    take: 1
  });

  return rows.records[0];
}

/** Everything a summary needs from the charges, allocations and proofs of one billing. */
type SummaryAggregate = BillingCounters & { earliestPendingDue: string | null };

const EMPTY_AGGREGATE: SummaryAggregate = {
  participantCount: 0,
  chargeCount: 0,
  paidCount: 0,
  proofsPending: 0,
  shareChargeId: null,
  earliestPendingDue: null
};

/**
 * One round trip for the whole page instead of three or four per row. `today` travels with each id
 * because the share candidate is timezone-bound: it prefers the nearest charge still due and only
 * falls back to the earliest overdue one. Dates are formatted in SQL so the driver cannot hand back
 * `Date` objects where the DTO promises `YYYY-MM-DD`.
 */
async function summaryAggregates(db: DbClient, rows: BillingRepository.Row[], now: Date): Promise<Map<string, SummaryAggregate>> {
  if (!rows.length) {
    return new Map();
  }

  const records = await db.rawQuery(
    `WITH page AS (
      SELECT * FROM unnest(string_to_array(:ids::text, ',')::uuid[], string_to_array(:todays::text, ',')::date[]) AS entry(billing_id, today)
    ),
    counters AS (
      SELECT p.billing_id,
        COUNT(c.id) FILTER (WHERE c.state <> 'cancelled') AS charge_count,
        COUNT(c.id) FILTER (WHERE c.state = 'paid') AS paid_count,
        to_char(MIN(c.due_date) FILTER (WHERE c.state = 'pending'), 'YYYY-MM-DD') AS earliest_pending
      FROM page p LEFT JOIN charges c ON c.billing_id = p.billing_id
      GROUP BY p.billing_id
    ),
    participants AS (
      SELECT p.billing_id, COUNT(DISTINCT a.user_id) AS participant_count
      FROM page p JOIN allocations a ON a.billing_id = p.billing_id AND a.kind = 'user'
      GROUP BY p.billing_id
    ),
    proofs AS (
      SELECT p.billing_id, COUNT(*) AS proofs_pending
      FROM page p
      JOIN charges c ON c.billing_id = p.billing_id AND c.state <> 'cancelled' AND c.proof_state = 'pending'
      GROUP BY p.billing_id
    ),
    share AS (
      SELECT DISTINCT ON (p.billing_id) p.billing_id, c.id AS charge_id
      FROM page p JOIN charges c ON c.billing_id = p.billing_id AND c.state = 'pending'
      ORDER BY p.billing_id, (c.due_date >= p.today) DESC, c.due_date ASC, c.id ASC
    )
    SELECT p.billing_id,
      COALESCE(counters.charge_count, 0) AS charge_count,
      COALESCE(counters.paid_count, 0) AS paid_count,
      counters.earliest_pending,
      COALESCE(participants.participant_count, 0) AS participant_count,
      COALESCE(proofs.proofs_pending, 0) AS proofs_pending,
      share.charge_id
    FROM page p
    LEFT JOIN counters ON counters.billing_id = p.billing_id
    LEFT JOIN participants ON participants.billing_id = p.billing_id
    LEFT JOIN proofs ON proofs.billing_id = p.billing_id
    LEFT JOIN share ON share.billing_id = p.billing_id`,
    {
      ids: rows.map((row) => row.id).join(','),
      todays: rows.map((row) => calendarDate(now, row.timezone)).join(',')
    }
  );

  return new Map(
    records.map((record) => {
      const participantCount = Number(record['participant_count'] ?? 0);
      const shareChargeId = record['charge_id'] ? String(record['charge_id']) : null;

      return [
        String(record['billing_id']),
        {
          participantCount,
          chargeCount: Number(record['charge_count'] ?? 0),
          paidCount: Number(record['paid_count'] ?? 0),
          proofsPending: Number(record['proofs_pending'] ?? 0),
          // The share action only makes sense while a single participant owns every charge.
          shareChargeId: participantCount === 1 ? shareChargeId : null,
          earliestPendingDue: record['earliest_pending'] ? String(record['earliest_pending']) : null
        }
      ];
    })
  );
}

function installmentCountFor(row: BillingRepository.Row): number | undefined {
  if (row.type === BillingType.Indefinite) {
    return undefined;
  }

  return billingDueDates({
    type: row.type,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule
  }).length;
}

async function summaryDto(db: DbClient, row: BillingRepository.Row, now: Date, aggregate: SummaryAggregate): Promise<BillingSummary> {
  const { earliestPendingDue, ...counters } = aggregate;
  const nextDueDate =
    earliestPendingDue ??
    (row.type === BillingType.Indefinite ? ((await previewsFor(db, row, effectiveReminders(row), now))[0]?.occurrenceDate ?? null) : null);

  return summary(row, nextDueDate, counters, installmentCountFor(row), await payeeOf(db, row));
}

async function dto(db: DbClient, row: BillingRepository.Row, now: Date, link?: InviteLinkContext): Promise<BillingDetail> {
  const reminders = effectiveReminders(row);
  const { split, allocations } = await BillingRepository.splitFor(db, row.id);
  const charges = await db.charges.findMany({
    select: ChargeRepository.SELECT,
    where: { billing_id: row.id },
    order: { due_date: Order.Asc, installment: Order.Asc }
  });
  const previews = await previewsFor(db, row, reminders, now);
  const earliest = await earliestPendingCharge(db, row.id);

  // The detail response has its own field list: the card counters stay out of it.
  return {
    id: row.id,
    direction: BillingRepository.direction(row),
    payee: await payeeOf(db, row),
    pix: billingPix(row),
    type: row.type,
    frequency: row.frequency,
    description: row.description,
    total: { amountCents: row.total_cents, currency: row.currency },
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule ?? BillingDueRule.Fixed,
    state: row.state,
    installmentCount: installmentCountFor(row),
    nextDueDate: earliest?.due_date ?? previews[0]?.occurrenceDate ?? null,
    createdAt: row.created_at,
    category: row.category,
    invite: link ? await activeInvite(db, row.id, link.secret, link.webOrigin, now) : null,
    guests: await BillingRepository.waitingGuests(db, row.id),
    linkableContacts: await ContactRepository.linkable(db, row.owner_id),
    updatedAt: row.updated_at,
    timezone: row.timezone,
    paymentMethodId: row.payment_method_id,
    reminders: parseReminders(row) ?? reminders,
    split,
    allocations,
    charges: await Promise.all(charges.records.map((charge) => ChargeRepository.dto(db, charge, row.owner_id))),
    previews,
    nextMaterialization: await nextMaterialization(db, row, reminders)
  };
}

function userIds(split: BillingSplit): string[] {
  return split.parts.flatMap((part) => (part.kind === SplitPartKind.User ? [part.userId] : []));
}

function decodeCursor(cursor?: string): { createdAt: string; id: string } | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };

    return typeof parsed.createdAt === 'string' && typeof parsed.id === 'string'
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Literal, case-insensitive description match resolved to ids so the paged read stays the same query.
 * The cursor clause is only spliced in when there is a cursor: a NULL date-time variable has no type
 * the driver can infer.
 */
async function searchBillingIds(
  db: DbClient,
  ownerId: string,
  filters: BillingRepository.Filters,
  cursor: { createdAt: string; id: string } | undefined,
  query: string
): Promise<string[]> {
  const paging = cursor ? 'AND (b.created_at < :createdAt OR (b.created_at = :createdAt AND b.id > :cursorId))' : '';
  const rows = await db.rawQuery(
    `SELECT b.id FROM billings b WHERE b.owner_id = :ownerId::uuid
    AND (:type::text IS NULL OR b.type = :type::text)
    AND (:state::text IS NULL OR b.state = :state::text)
    AND (:category::text IS NULL OR b.category = :category::text)
    AND (:direction::text IS NULL OR COALESCE(b.direction, 'receivable') = :direction::text)
    AND position(:query::text in lower(b.description)) > 0
    ${paging}
    ORDER BY b.created_at DESC, b.id ASC LIMIT ${PAGE_SIZE + 1}`,
    {
      ownerId,
      type: filters.type ?? null,
      state: filters.state ?? null,
      category: filters.category ?? null,
      direction: filters.direction ?? null,
      ...(cursor ? { createdAt: cursor.createdAt, cursorId: cursor.id } : {}),
      query
    }
  );

  return rows.map((row) => String(row['id']));
}

const enum ChargeCancelReason {
  BillingPaused = 'billing_paused',
  BillingEnded = 'billing_ended',
  BillingEdited = 'billing_edited'
}

async function cancelPendingCharges(
  db: DbClient,
  ownerId: string,
  billingId: string,
  now: string,
  reason: ChargeCancelReason,
  after?: string
) {
  const pending = await db.charges.findMany({
    select: ChargeRepository.SELECT,
    where: { billing_id: billingId, state: ChargeState.Pending, ...(after ? { due_date: { gt: after } } : {}) },
    lock: true
  });

  for (const row of pending.records) {
    await db.charges.updateOne({ where: { id: row.id }, data: { state: ChargeState.Cancelled, cancelled_at: now, updated_at: now } });
    await EventRepository.record(db, {
      type: 'charge.cancelled',
      eventableType: EventableType.Charge,
      eventableId: row.id,
      actorId: ownerId,
      payload: { reason },
      at: now
    });
  }
}

/**
 * Pausar never cancels unless the caller says `Cancel`: pausing keeps every pending charge no matter
 * what an old app sends (absent or `Keep`), so a −N reminder that already materialized next month's
 * charge is never left stranded past the resume cursor. Encerrar keeps its old default: absent cancels
 * everything, `Keep` only drops what falls after this month, `Cancel` drops every pending charge.
 */
async function settlePendingCharges(db: DbClient, ownerId: string, billingId: string, patch: BillingPatch, today: string, now: string) {
  const ended = patch.state === BillingState.Ended;
  const reason = ended ? ChargeCancelReason.BillingEnded : ChargeCancelReason.BillingPaused;

  if (!ended) {
    if (patch.pendingCharges === PendingChargesAction.Cancel) {
      await cancelPendingCharges(db, ownerId, billingId, now, reason);
    }

    return;
  }

  const action = patch.pendingCharges ?? PendingChargesAction.Cancel;

  if (action === PendingChargesAction.Cancel) {
    await cancelPendingCharges(db, ownerId, billingId, now, reason);
    return;
  }

  await cancelPendingCharges(db, ownerId, billingId, now, reason, endOfMonth(today));
}

/** Whether the patch changes anything a charge carries; reminders and category never reach a materialized charge. */
function touchesCharges(patch: BillingPatch): boolean {
  return (
    patch.totalCents !== undefined ||
    patch.split !== undefined ||
    patch.description !== undefined ||
    patch.paymentMethodId !== undefined ||
    patch.clearPaymentMethod !== undefined ||
    patch.pix !== undefined ||
    patch.clearPix !== undefined ||
    patch.payeeUserId !== undefined ||
    patch.clearPayee !== undefined ||
    patch.startDate !== undefined ||
    patch.dueRule !== undefined
  );
}

/** EditScope.CurrentMonth: this month's charges that are not due yet follow the edit; returns the created charge ids to announce. */
async function rewriteMonthCharges(
  db: DbClient,
  row: BillingRepository.Row,
  patch: BillingPatch,
  today: string,
  now: string
): Promise<string[]> {
  const monthEnd = endOfMonth(today);
  const { records } = await db.charges.findMany({
    select: ChargeRepository.SELECT,
    where: { billing_id: row.id, state: ChargeState.Pending, due_date: { gt: today, lte: monthEnd } },
    lock: true
  });
  const editable = records.filter((charge) => !charge.proof_state || charge.proof_state === StoredProofState.Rejected);

  if (!editable.length) {
    return [];
  }

  const rescheduled = patch.startDate !== undefined || patch.dueRule !== undefined;
  const pixTouched = patch.paymentMethodId !== undefined || patch.clearPaymentMethod || patch.pix !== undefined || patch.clearPix;

  // Monthly and yearly rules have one occurrence per month: only a reschedule looks for a new day inside
  // the month; otherwise the stale start_date/due_rule from an earlier NextMonth edit must not leak in.
  const dueDate = rescheduled
    ? (billingDates(calendarRule(row), addCalendarDays(today, 1), monthEnd, 1)[0] ?? editable[0]!.due_date)
    : editable[0]!.due_date;
  const { split } = await BillingRepository.splitFor(db, row.id);
  const payable = payableOf(row);
  const payer = payable ? payable.payer : ChargePayer.Person;
  const plan = planBillingCharges({
    description: row.description,
    totalCents: row.total_cents,
    split,
    dueDates: [dueDate],
    numbered: false,
    payer,
    payeeUserId: row.payee_user_id ?? null
  });
  const existing: MonthCharge[] = editable.map((charge) => ({
    id: charge.id,
    debtorUserId: charge.debtor_user_id ?? null,
    dueDate: charge.due_date
  }));
  const changes = monthChanges(existing, plan.charges);

  // Only the people entering this month need revalidation; an archived contact or key elsewhere on the
  // billing must not fail an update to someone already on it. A conta a pagar without a payee still
  // needs a context to create its owner-only charge, even though nobody "enters" by user id.
  const entering = changes.create.map((planned) => planned.userId).filter((userId): userId is string => userId != null);
  const context =
    pixTouched || changes.create.length
      ? await prepareChargeMaterialization(db, row.owner_id, entering, row.payment_method_id, payable)
      : undefined;

  for (const { charge, planned } of changes.update) {
    const moving = rescheduled && planned.dueDate !== charge.dueDate;
    const blocked =
      moving &&
      (await db.charges.count({
        where: { billing_id: row.id, debtor_user_id: charge.debtorUserId ?? sqlNull, due_date: planned.dueDate }
      }));

    if (blocked) {
      continue;
    }

    await db.charges.updateOne({
      where: { id: charge.id },
      data: {
        description: planned.description,
        amount_cents: planned.amountCents,
        ...(moving ? { due_date: planned.dueDate } : {}),
        ...(pixTouched
          ? {
              pix_key_type_snapshot: context!.pix?.keyType ?? sqlNull,
              pix_key_snapshot: context!.pix?.key ?? sqlNull,
              pix_label_snapshot: context!.pix?.label ?? sqlNull
            }
          : {}),
        updated_at: now
      }
    });
    await EventRepository.record(db, {
      type: 'charge.edited',
      eventableType: EventableType.Charge,
      eventableId: charge.id,
      actorId: row.owner_id,
      at: now
    });
  }

  for (const charge of changes.cancel) {
    await db.charges.updateOne({ where: { id: charge.id }, data: { state: ChargeState.Cancelled, cancelled_at: now, updated_at: now } });
    await EventRepository.record(db, {
      type: 'charge.cancelled',
      eventableType: EventableType.Charge,
      eventableId: charge.id,
      actorId: row.owner_id,
      payload: { reason: ChargeCancelReason.BillingEdited },
      at: now
    });
  }

  const creatable: typeof plan.charges = [];

  for (const planned of changes.create) {
    // A cancelled charge of the same person on the same date holds the unique index: the person joins next month.
    const taken = await db.charges.count({
      where: { billing_id: row.id, debtor_user_id: planned.userId ?? sqlNull, due_date: planned.dueDate }
    });

    if (!taken) {
      creatable.push(planned);
    }
  }

  if (!creatable.length) {
    return [];
  }

  const persisted = await persistChargePlan(
    db,
    row.owner_id,
    { ...plan, charges: creatable },
    { id: row.id, type: BillingType.Indefinite },
    context!,
    now
  );

  return persisted.noticeChargeIds;
}

function assertPatchAllowed(row: BillingRepository.Row, patch: BillingPatch) {
  if (row.state === BillingState.Ended) {
    throw new BillingEndedError();
  }

  const settles = patch.state === BillingState.Paused || patch.state === BillingState.Ended;

  if (patch.pendingCharges !== undefined && !settles) {
    throw new PendingChargesWithoutStateError();
  }

  if (patch.applyTo !== undefined && row.type !== BillingType.Indefinite) {
    throw new EditScopeNotRecurringError();
  }

  if (patch.state === BillingState.Paused && row.type !== BillingType.Indefinite) {
    throw new BillingNotPausableError();
  }

  const payable = BillingRepository.direction(row) === Direction.Payable;

  // Each direction has its own Pix source: the owner's wallet collects, a typed key pays.
  if (payable && (patch.paymentMethodId !== undefined || patch.split !== undefined)) {
    throw new PayableHasNoSplitError();
  }

  if (!payable && (patch.pix !== undefined || patch.clearPix || patch.payeeUserId !== undefined || patch.clearPayee)) {
    throw new ReceivableHasNoPayeeError();
  }

  const payeeChanged = patch.payeeUserId !== undefined || patch.clearPayee;
  const frozen =
    row.type !== BillingType.Indefinite &&
    (patch.description !== undefined ||
      patch.totalCents !== undefined ||
      patch.split !== undefined ||
      payeeChanged ||
      patch.startDate !== undefined ||
      patch.dueRule !== undefined);

  if (frozen) {
    throw new BillingSnapshotLockedError();
  }
}

/** The new due day only governs occurrences not generated yet: the cursor never moves backwards. */
function rescheduledCursor(row: BillingRepository.Row, startDate: string, today: string): string {
  if (startDate < today) {
    throw new RangeError('O próximo vencimento não pode estar no passado.');
  }

  const boundary = addCalendarDays(startDate, -1);

  return (row.processed_through ?? boundary) > boundary ? row.processed_through! : boundary;
}

/** A new due day never adds a second charge to a month that already has one: that month is skipped. */
async function rescheduledMonthCursor(db: DbClient, row: BillingRepository.Row, startDate: string, today: string): Promise<string> {
  const cursor = rescheduledCursor(row, startDate, today);
  const monthEnd = endOfMonth(startDate);
  const taken = await db.charges.count({ where: { billing_id: row.id, due_date: { gte: `${startDate.slice(0, 7)}-01`, lte: monthEnd } } });

  if (!taken) {
    return cursor;
  }

  return cursor > monthEnd ? cursor : monthEnd;
}

function billingInputFrom(row: BillingRepository.Row, split: BillingSplit): BillingInput {
  const direction = BillingRepository.direction(row);
  const pix = billingPix(row);

  return {
    type: row.type,
    frequency: row.frequency,
    description: row.description,
    totalCents: row.total_cents,
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule,
    timezone: row.timezone,
    paymentMethodId: row.payment_method_id,
    split,
    category: row.category,
    direction,
    payeeUserId: row.payee_user_id,
    pix: pix ? { keyType: pix.keyType, key: pix.key, label: pix.label } : undefined
  };
}

/** Occurrences already past their materialization date, oldest first. */
function dueOccurrences(row: BillingRepository.Row, now: Date, limit: number): string[] {
  if (row.state !== BillingState.Active || row.type !== BillingType.Indefinite) {
    return [];
  }

  const today = calendarDate(now, row.timezone);
  const latest = materializationHorizon(today, effectiveReminders(row));
  const cursor = row.processed_through ?? addCalendarDays(row.start_date, -1);

  return billingDates(calendarRule(row), addCalendarDays(cursor, 1), latest, limit);
}

/** Fresh result per call: `noticeChargeIds` is handed to callers that may append to it. */
const idleOccurrence = (): BillingRepository.OccurrenceResult => ({ materialized: false, remaining: false, noticeChargeIds: [] });

export namespace BillingRepository {
  export const SELECT = {
    id: true,
    owner_id: true,
    type: true,
    frequency: true,
    description: true,
    category: true,
    total_cents: true,
    currency: true,
    start_date: true,
    end_date: true,
    due_rule: true,
    timezone: true,
    payment_method_id: true,
    direction: true,
    payee_user_id: true,
    pix_key_type: true,
    pix_key: true,
    pix_label: true,
    reminders: true,
    state: true,
    processed_through: true,
    idempotency_key: true,
    request_hash: true,
    created_at: true,
    updated_at: true
  } as const;

  export type Row = {
    id: string;
    owner_id: string;
    type: BillingType;
    frequency?: BillingFrequency;
    description: string;
    category: BillingCategory;
    total_cents: number;
    currency: 'BRL';
    start_date: string;
    end_date?: string;
    /** Null on rows written before the rule existed: read as 'fixed'. */
    due_rule?: BillingDueRule;
    timezone: string;
    payment_method_id?: string;
    /** Null on rows written before contas a pagar existed: the owner collects. */
    direction?: Direction;
    payee_user_id?: string;
    pix_key_type?: PixKeyType;
    pix_key?: string;
    pix_label?: string;
    reminders?: string;
    state: BillingState;
    processed_through?: string;
    request_hash: string;
    created_at: string;
    updated_at: string;
  };

  export type Filters = {
    type?: BillingType;
    state?: BillingState;
    direction?: Direction;
    cursor?: string;
    search?: string;
    category?: BillingCategory;
  };

  /** Rows written before contas a pagar existed carry no direction: the owner collects. */
  export function direction(row: Pick<Row, 'direction'>): Direction {
    return row.direction ?? Direction.Receivable;
  }

  export async function splitFor(db: DbClient, id: string): Promise<{ split: BillingSplit; allocations: BillingAllocation[] }> {
    const rows = (
      await db.allocations.findMany({
        select: {
          kind: true,
          user_id: true,
          split_mode: true,
          amount_cents: true,
          basis_points: true,
          shares: true,
          allocation_order: true
        },
        where: { billing_id: id },
        order: { allocation_order: Order.Asc }
      })
    ).records;
    const mode = rows[0]?.split_mode ?? SplitMode.Equal;
    const parties = rows.map((row) =>
      row.kind === SplitPartKind.Owner
        ? { kind: SplitPartKind.Owner as const }
        : { kind: SplitPartKind.User as const, userId: row.user_id! }
    );
    const split: BillingSplit =
      mode === SplitMode.Fixed
        ? {
            mode,
            parts: rows.flatMap((row) =>
              row.kind === SplitPartKind.User
                ? [{ kind: SplitPartKind.User as const, userId: row.user_id!, amountCents: row.amount_cents }]
                : []
            )
          }
        : mode === SplitMode.Equal
          ? { mode, parts: parties }
          : mode === SplitMode.Shares
            ? { mode, parts: parties.map((party, index) => ({ ...party, shares: rows[index]!.shares ?? 1 })) }
            : { mode, parts: parties.map((party, index) => ({ ...party, basisPoints: rows[index]!.basis_points! })) };
    const allocations = rows.map((row) => ({
      kind: row.kind,
      userId: row.user_id ?? null,
      splitMode: row.split_mode,
      amount: { amountCents: row.amount_cents, currency: 'BRL' as const },
      order: row.allocation_order,
      ...(row.shares === undefined || row.shares === null ? {} : { shares: row.shares })
    }));

    return { split, allocations };
  }

  /** Guests still waiting on the owner of `billingId`, with the live name and e-mail of each account. */
  export async function waitingGuests(db: DbClient, billingId: string): Promise<BillingGuest[]> {
    const { records } = await db.billing_guests.findMany({
      select: { id: true, user_id: true, created_at: true },
      where: { billing_id: billingId, state: BillingGuestState.Pending }
    });

    if (!records.length) {
      return [];
    }

    const { records: users } = await db.users.findMany({
      select: { id: true, name: true, email: true, status: true, avatar_updated_at: true },
      where: { id: { isIn: records.map((row) => row.user_id) } }
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    return records
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .flatMap((row) => {
        const user = byId.get(row.user_id);

        if (!user || user.status === UserStatus.Removed) {
          return [];
        }

        return [
          {
            id: row.id,
            userId: row.user_id,
            name: ContactRepository.personName(user),
            email: user.email ?? '',
            createdAt: row.created_at,
            avatar: AvatarRepository.ref(user.id, user.avatar_updated_at)
          }
        ];
      });
  }

  export async function audit(db: DbClient, ownerId: string, id: string, type: string, now: string, payload: Record<string, unknown> = {}) {
    await EventRepository.record(db, { type, eventableType: EventableType.Billing, eventableId: id, actorId: ownerId, payload, at: now });
  }

  export async function saveAllocations(db: DbClient, id: string, totalCents: number, split: BillingSplit, now: string) {
    const resolved = resolveBillingSplit(totalCents, split);

    await db.allocations.deleteMany({ where: { billing_id: id } });

    for (const [index, part] of resolved.entries()) {
      const original = split.parts[index];

      await db.allocations.insertOne({
        data: {
          id: crypto.randomUUID(),
          billing: { id },
          kind: part.kind,
          ...(part.kind === SplitPartKind.User ? { user: { id: part.userId } } : {}),
          split_mode: split.mode,
          amount_cents: part.amountCents,
          allocation_order: index,
          ...(original && 'basisPoints' in original ? { basis_points: original.basisPoints } : {}),
          // Only the `shares` mode owns the quota column; a stray field on another mode stays null.
          ...(split.mode === SplitMode.Shares && original && 'shares' in original ? { shares: original.shares } : {}),
          created_at: now
        }
      });
    }
  }

  export async function create(
    db: DbClient,
    ownerId: string,
    key: string,
    raw: BillingInput,
    now = new Date(),
    link?: InviteLinkContext,
    notice?: NoticeContext
  ): Promise<BillingDetail> {
    if (!key.trim() || key.length > 200) {
      throw new RangeError('Idempotency-Key inválida.');
    }

    const input = normalizeBillingInput(raw);
    const hash = billingRequestFingerprint(input);
    const noticeChargeIds: string[] = [];

    const detail = await db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);

      const existing = await tx.billings.findOne({ select: SELECT, where: { owner_id: ownerId, idempotency_key: key } });

      if (existing) {
        if (existing.request_hash !== hash) {
          throw new IdempotencyMismatchError();
        }

        return dto(tx, existing, now, link);
      }

      const today = calendarDate(now, input.timezone);

      if (input.type === BillingType.Indefinite && input.startDate < today) {
        throw new RangeError('O início não pode estar no passado.');
      }

      const payable: PayableMaterialization | undefined =
        input.direction === Direction.Payable ? { payer: ChargePayer.Owner, pix: input.pix } : undefined;
      const counterparts = payable ? (input.payeeUserId ? [input.payeeUserId] : []) : userIds(input.split);
      const context = await prepareChargeMaterialization(tx, ownerId, counterparts, input.paymentMethodId, payable);
      const id = crypto.randomUUID();
      const instant = now.toISOString();
      const row = await tx.billings.insertOne({
        select: SELECT,
        data: {
          id,
          owner: { id: ownerId },
          type: input.type,
          frequency: input.frequency ?? sqlNull,
          description: input.description,
          category: input.category ?? BillingCategory.Other,
          total_cents: input.totalCents,
          currency: 'BRL',
          start_date: input.startDate,
          end_date: input.endDate ?? sqlNull,
          due_rule: input.dueRule ?? BillingDueRule.Fixed,
          timezone: input.timezone,
          ...(input.paymentMethodId ? { payment_method: { id: input.paymentMethodId } } : {}),
          direction: input.direction,
          ...(input.payeeUserId ? { payee_user: { id: input.payeeUserId } } : {}),
          pix_key_type: input.pix?.keyType ?? sqlNull,
          pix_key: input.pix?.key ?? sqlNull,
          pix_label: input.pix?.label ?? sqlNull,
          reminders: input.reminders ? JSON.stringify(input.reminders) : sqlNull,
          state: BillingState.Active,
          processed_through: input.type === BillingType.Indefinite ? addCalendarDays(today, -1) : sqlNull,
          idempotency_key: key,
          request_hash: hash,
          created_at: instant,
          updated_at: instant
        }
      });

      await saveAllocations(tx, id, input.totalCents, input.split, instant);

      if (input.type !== BillingType.Indefinite) {
        const plan = planBillingCharges({
          description: input.description,
          totalCents: input.totalCents,
          split: input.split,
          dueDates: billingDueDates(input),
          numbered: true,
          payer: context.payer,
          payeeUserId: input.payeeUserId ?? null
        });

        const persisted = await persistChargePlan(tx, ownerId, plan, { id, type: input.type }, context, instant);

        noticeChargeIds.push(...persisted.noticeChargeIds);
      }

      await audit(tx, ownerId, id, 'billing.created', instant, { type: input.type });

      return dto(tx, row, now, link);
    });

    // The rows are committed before anyone hears about them.
    if (notice) {
      await announceCharges(db, notice, noticeChargeIds, now.getTime());
    }

    // An assinatura gets the charges of its first month right away instead of waiting for the daily sweep.
    const materialized =
      input.type === BillingType.Indefinite && detail.state === BillingState.Active && !detail.charges.length
        ? (await materializeDue(db, detail.id, notice, now)).materialized
        : false;

    return materialized ? get(db, ownerId, detail.id, now, link) : detail;
  }

  export async function get(db: DbClient, ownerId: string, id: string, now = new Date(), link?: InviteLinkContext): Promise<BillingDetail> {
    return dto(db, await billingRow(db, ownerId, id), now, link);
  }

  export async function list(db: DbClient, ownerId: string, filters: Filters = {}, now = new Date()): Promise<BillingsPage> {
    const cursor = decodeCursor(filters.cursor);
    const query = (filters.search ?? '').normalize('NFC').trim().toLocaleLowerCase('pt-BR').slice(0, SEARCH_LIMIT);

    let matchingIds: string[] | undefined;

    if (query) {
      matchingIds = await searchBillingIds(db, ownerId, filters, cursor, query);

      if (!matchingIds.length) {
        return { billings: [], nextCursor: null };
      }
    }

    const result = await db.billings.findMany({
      select: SELECT,
      where: {
        AND: [
          { owner_id: ownerId },
          ...(filters.type ? [{ type: filters.type }] : []),
          ...(filters.state ? [{ state: filters.state }] : []),
          // Legacy rows carry no direction and are receivable.
          ...(filters.direction === Direction.Payable
            ? [{ direction: Direction.Payable as const }]
            : filters.direction === Direction.Receivable
              ? [{ OR: [{ direction: Direction.Receivable as const }, { direction: { isNull: true } }] }]
              : []),
          ...(matchingIds ? [{ id: { isIn: matchingIds } }] : []),
          ...(cursor ? [{ OR: [{ created_at: { lt: cursor.createdAt } }, { created_at: cursor.createdAt, id: { gt: cursor.id } }] }] : [])
        ]
      },
      order: { created_at: Order.Desc, id: Order.Asc },
      take: PAGE_SIZE + 1
    });
    const page = result.records.slice(0, PAGE_SIZE);
    const last = result.records.length > PAGE_SIZE ? page.at(-1) : undefined;

    const aggregates = await summaryAggregates(db, page, now);

    return {
      billings: await Promise.all(page.map((row) => summaryDto(db, row, now, aggregates.get(row.id) ?? EMPTY_AGGREGATE))),
      nextCursor: last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url') : null
    };
  }

  export async function preview(db: DbClient, ownerId: string, id: string, now = new Date()): Promise<{ previews: BillingPreview[] }> {
    const row = await billingRow(db, ownerId, id);

    if (row.type !== BillingType.Indefinite) {
      throw new BillingPreviewUnavailableError();
    }

    return { previews: await previewsFor(db, row, effectiveReminders(row), now) };
  }

  export async function patch(
    db: DbClient,
    ownerId: string,
    id: string,
    patch: BillingPatch,
    now = new Date(),
    link?: InviteLinkContext,
    notice?: NoticeContext
  ): Promise<BillingDetail> {
    const noticeChargeIds: string[] = [];
    const detail = await db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);

      const row = await billingRow(tx, ownerId, id, true);

      assertPatchAllowed(row, patch);

      const instant = now.toISOString();
      const today = calendarDate(now, row.timezone);
      const totalCents = patch.totalCents ?? row.total_cents;
      const split = patch.split ?? (await splitFor(tx, row.id)).split;
      const paymentMethodId = patch.clearPaymentMethod ? undefined : (patch.paymentMethodId ?? row.payment_method_id);
      const payeeUserId = patch.clearPayee ? undefined : (patch.payeeUserId ?? row.payee_user_id);
      const description = patch.description === undefined ? row.description : patch.description.normalize('NFC').trim() || 'Conta';
      const pixPatched = patch.pix !== undefined || patch.clearPix;
      const normalized =
        patch.reminders !== undefined || patch.pix !== undefined
          ? normalizeBillingInput({
              ...billingInputFrom(row, split),
              ...(patch.reminders !== undefined ? { reminders: patch.reminders } : {}),
              ...(patch.pix !== undefined ? { pix: patch.pix } : {})
            })
          : undefined;
      const reminders = patch.reminders === undefined ? undefined : normalized?.reminders;
      const pix = patch.clearPix ? null : patch.pix !== undefined ? (normalized?.pix ?? null) : billingPix(row);
      const payable = payableOf({ ...row, pix_key_type: pix?.keyType, pix_key: pix?.key, pix_label: pix?.label });

      // Only newly introduced recipients/Pix need revalidation; materializeNextOccurrence re-checks the stored
      // split at occurrence time, so an already-persisted split must not block unrelated edits (e.g. ending
      // a billing whose recipient was archived later).
      if (patch.split !== undefined || patch.paymentMethodId !== undefined || patch.clearPaymentMethod || pixPatched || patch.payeeUserId) {
        const counterparts = payable ? (payeeUserId ? [payeeUserId] : []) : userIds(split);

        await prepareChargeMaterialization(tx, ownerId, counterparts, paymentMethodId, payable);
      }

      if (patch.split !== undefined || patch.totalCents !== undefined) {
        await saveAllocations(tx, id, totalCents, split, instant);
      }

      const resumed = patch.state === BillingState.Active && row.state === BillingState.Paused;
      const boundary = addCalendarDays(today, -1);
      const startDate = patch.startDate ?? row.start_date;
      const dueRule = patch.dueRule ?? row.due_rule ?? BillingDueRule.Fixed;
      const rescheduled = startDate !== row.start_date || dueRule !== (row.due_rule ?? BillingDueRule.Fixed);

      if (rescheduled) {
        // Same checks as creation: a real date, a month end only on monthly rules, and on its last day.
        normalizeBillingInput({ ...billingInputFrom(row, split), totalCents, startDate, dueRule });
      }

      const cursor = rescheduled ? await rescheduledMonthCursor(tx, row, startDate, today) : undefined;

      const updated = await tx.billings.updateOne({
        select: SELECT,
        where: { id },
        data: {
          description,
          category: patch.category ?? row.category,
          total_cents: totalCents,
          payment_method: { id: paymentMethodId ?? sqlNull },
          payee_user: { id: payeeUserId ?? sqlNull },
          pix_key_type: pix?.keyType ?? sqlNull,
          pix_key: pix?.key ?? sqlNull,
          pix_label: pix?.label ?? sqlNull,
          ...(patch.reminders !== undefined ? { reminders: JSON.stringify(reminders) } : {}),
          ...(patch.state ? { state: patch.state } : {}),
          ...(resumed ? { processed_through: (row.processed_through ?? boundary) > boundary ? row.processed_through : boundary } : {}),
          // A new due day wins over the resume cursor: both only ever move the cursor forward.
          ...(rescheduled ? { start_date: startDate, due_rule: dueRule, processed_through: cursor } : {}),
          updated_at: instant
        }
      });

      if (!updated) {
        throw new HttpNotFoundError();
      }

      if (patch.state === BillingState.Paused || patch.state === BillingState.Ended) {
        await settlePendingCharges(tx, ownerId, id, patch, today, instant);
      }

      // A paused/ended billing never materializes new occurrences; applyTo must not create one either.
      if (patch.applyTo === EditScope.CurrentMonth && touchesCharges(patch) && (patch.state ?? row.state) === BillingState.Active) {
        noticeChargeIds.push(...(await rewriteMonthCharges(tx, await billingRow(tx, ownerId, id), patch, today, instant)));
      }

      await audit(tx, ownerId, id, patch.state ? `billing.${patch.state}` : 'billing.edited', instant);

      return dto(tx, await billingRow(tx, ownerId, id), now, link);
    });

    if (notice && noticeChargeIds.length) {
      await announceCharges(db, notice, noticeChargeIds, now.getTime());
    }

    // A due day moved into the past, or a resumed billing, may owe an occurrence right away.
    if (notice && (patch.startDate !== undefined || patch.dueRule !== undefined || patch.state === BillingState.Active)) {
      await materializeDue(db, id, notice, now);
    }

    return detail ? get(db, ownerId, id, now, link) : detail;
  }

  export type OccurrenceResult = {
    materialized: boolean;
    remaining: boolean;
    skipped?: string;
    noticeChargeIds: string[];
  };

  /** The daily sweep: every active assinatura gets its due occurrences; the count is what was created. */
  export async function materializeDueBillings(db: DbClient, notice?: NoticeContext, now = new Date()): Promise<number> {
    const { records } = await db.billings.findMany({
      select: { id: true },
      where: { type: BillingType.Indefinite, state: BillingState.Active },
      order: { id: Order.Asc }
    });

    let materialized = 0;

    for (const { id } of records) {
      try {
        if ((await materializeDue(db, id, notice, now)).materialized) {
          materialized++;
        }
      } catch (error) {
        // One broken billing must not stop the others; it is retried tomorrow.
        console.error('Billing materialization failed', { billingId: id, error: error instanceof Error ? error.message : 'unknown' });
      }
    }

    return materialized;
  }

  export type MaterializeDueResult = { materialized: boolean; skipped?: string };

  /** Materializes every occurrence already due and announces the charges; `skipped` names an owner-side blocker. */
  export async function materializeDue(
    db: DbClient,
    billingId: string,
    notice?: NoticeContext,
    now = new Date()
  ): Promise<MaterializeDueResult> {
    let materialized = false;
    let result = await materializeNextOccurrence(db, billingId, now);

    while (result.materialized) {
      materialized = true;

      if (notice) {
        await announceCharges(db, notice, result.noticeChargeIds, now.getTime());
      }

      if (!result.remaining) {
        break;
      }

      result = await materializeNextOccurrence(db, billingId, now);
    }

    return { materialized, ...(result.skipped ? { skipped: result.skipped } : {}) };
  }

  /** Materializes a single occurrence; the caller announces the charges once the transaction commits. */
  export async function materializeNextOccurrence(db: DbClient, billingId: string, now = new Date()): Promise<OccurrenceResult> {
    const owner = await db.billings.findOne({ select: { owner_id: true }, where: { id: billingId } });

    if (!owner) {
      return idleOccurrence();
    }

    try {
      return await db.transaction(async (tx) => {
        await lockOwner(tx, owner.owner_id);

        const row = await billingRow(tx, owner.owner_id, billingId, true);
        const [dueDate, ...rest] = dueOccurrences(row, now, 2);

        if (!dueDate) {
          return idleOccurrence();
        }

        const instant = now.toISOString();
        const noticeChargeIds: string[] = [];
        const exists = await tx.charges.count({ where: { billing_id: row.id, due_date: dueDate } });

        if (!exists) {
          const { split } = await splitFor(tx, row.id);
          const payable = payableOf(row);
          const counterparts = payable ? (row.payee_user_id ? [row.payee_user_id] : []) : userIds(split);
          const context = await prepareChargeMaterialization(tx, row.owner_id, counterparts, row.payment_method_id, payable);
          const plan = planBillingCharges({
            description: row.description,
            totalCents: row.total_cents,
            split,
            dueDates: [dueDate],
            numbered: false,
            payer: context.payer,
            payeeUserId: row.payee_user_id ?? null
          });

          const persisted = await persistChargePlan(tx, row.owner_id, plan, { id: row.id, type: BillingType.Indefinite }, context, instant);

          noticeChargeIds.push(...persisted.noticeChargeIds);

          await audit(tx, row.owner_id, row.id, 'billing.materialized', instant, { dueDate });
        }

        await tx.billings.updateOne({ where: { id: row.id }, data: { processed_through: dueDate, updated_at: instant } });

        return { materialized: !exists, remaining: rest.length > 0, noticeChargeIds };
      });
    } catch (error) {
      // An archived recipient/Pix is not transient: retrying it would only burn the queue attempts.
      if (!(error instanceof HttpNotFoundError)) {
        throw error;
      }

      const reason = error.message || 'unavailable';

      await db.transaction(async (tx) => {
        await audit(tx, owner.owner_id, billingId, 'billing.materialization_skipped', now.toISOString(), { reason });
      });

      return { ...idleOccurrence(), skipped: reason };
    }
  }
}
