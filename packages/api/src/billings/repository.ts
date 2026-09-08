import { Order } from '@ez4/database';
import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import {
  addCalendarDays,
  type BillingAllocation,
  type BillingCategory,
  type BillingDetail,
  type BillingInput,
  type BillingPatch,
  type BillingPreview,
  type BillingReminder,
  type BillingSplit,
  type BillingState,
  type BillingSummary,
  type BillingsPage,
  type BillingType,
  billingDates,
  billingDueDates,
  calendarDate,
  DEFAULT_BILLING_REMINDERS,
  materializationDate,
  normalizeBillingInput,
  planBillingCharges,
  resolveBillingSplit
} from '@receivy/common';
import { lockOwner, persistChargePlan, prepareChargeMaterialization } from '../charges/materialize';
import { CHARGE_SELECT, chargeDto } from '../charges/repository';
import type { DbClient } from '../database';
import { closeProofs } from '../proofs/events';
import { billingRequestFingerprint } from './request';

export const BILLING_SELECT = {
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
  timezone: true,
  payment_method_id: true,
  reminders: true,
  state: true,
  processed_through: true,
  idempotency_key: true,
  request_hash: true,
  created_at: true,
  updated_at: true
} as const;

export type BillingRow = {
  id: string;
  owner_id: string;
  type: BillingType;
  frequency?: 'monthly' | 'yearly';
  description: string;
  category: BillingCategory;
  total_cents: number;
  currency: 'BRL';
  start_date: string;
  end_date?: string;
  timezone: string;
  payment_method_id?: string;
  reminders?: string;
  state: BillingState;
  processed_through?: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
};

export type BillingFilters = {
  type?: BillingType;
  state?: BillingState;
  cursor?: string;
  search?: string;
  category?: BillingCategory;
};

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
const MATERIALIZATION_BUDGET = 100;

function parseReminders(row: Pick<BillingRow, 'reminders'>): BillingReminder[] | undefined {
  return row.reminders ? (JSON.parse(row.reminders) as BillingReminder[]) : undefined;
}

/** Offsets used for this billing: its own reminders, else the due-date-only default. */
export function effectiveReminders(row: Pick<BillingRow, 'reminders'>): BillingReminder[] {
  return parseReminders(row) ?? DEFAULT_BILLING_REMINDERS;
}

async function billingRow(db: DbClient, ownerId: string, id: string, lock = false): Promise<BillingRow> {
  const row = await db.billings.findOne({ select: BILLING_SELECT, where: { id, owner_id: ownerId }, lock });

  if (!row) {
    throw new HttpNotFoundError();
  }

  return row;
}

async function splitFor(db: DbClient, id: string): Promise<{ split: BillingSplit; allocations: BillingAllocation[] }> {
  const rows = (
    await db.allocations.findMany({
      select: {
        kind: true,
        person_id: true,
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
  const mode = rows[0]?.split_mode ?? 'equal';
  const parties = rows.map((row) =>
    row.kind === 'owner' ? { kind: 'owner' as const } : { kind: 'person' as const, personId: row.person_id! }
  );
  const split: BillingSplit =
    mode === 'fixed'
      ? {
          mode,
          parts: rows.flatMap((row) =>
            row.kind === 'person' ? [{ kind: 'person' as const, personId: row.person_id!, amountCents: row.amount_cents }] : []
          )
        }
      : mode === 'equal'
        ? { mode, parts: parties }
        : mode === 'shares'
          ? { mode, parts: parties.map((party, index) => ({ ...party, shares: rows[index]!.shares ?? 1 })) }
          : { mode, parts: parties.map((party, index) => ({ ...party, basisPoints: rows[index]!.basis_points! })) };
  const allocations = rows.map((row) => ({
    kind: row.kind,
    personId: row.person_id ?? null,
    splitMode: row.split_mode,
    amount: { amountCents: row.amount_cents, currency: 'BRL' as const },
    order: row.allocation_order,
    ...(row.shares === undefined || row.shares === null ? {} : { shares: row.shares })
  }));

  return { split, allocations };
}

function calendarRule(row: BillingRow) {
  return { frequency: row.frequency!, startDate: row.start_date, endDate: row.end_date };
}

async function previewsFor(db: DbClient, row: BillingRow, reminders: BillingReminder[], now: Date): Promise<BillingPreview[]> {
  if (row.type !== 'indefinite' || row.state !== 'active') {
    return [];
  }

  const today = calendarDate(now, row.timezone);
  const cursor = row.processed_through ?? addCalendarDays(today, -1);
  const existing = (
    await db.charges.findMany({ select: { due_date: true }, where: { billing_id: row.id, due_date: { gte: today } } })
  ).records.map((charge) => charge.due_date);
  const external = resolveBillingSplit(row.total_cents, (await splitFor(db, row.id)).split)
    .filter((allocation) => allocation.kind === 'person')
    .reduce((sum, allocation) => sum + allocation.amountCents, 0);

  return billingDates(calendarRule(row), today, addCalendarDays(today, PREVIEW_DAYS))
    .filter((date) => !existing.includes(date) && date > cursor)
    .map((occurrenceDate) => ({
      billingId: row.id,
      description: row.description,
      amount: { amountCents: external, currency: 'BRL' as const },
      occurrenceDate,
      materializationDate: materializationDate(occurrenceDate, reminders)
    }));
}

async function nextMaterialization(db: DbClient, row: BillingRow, reminders: BillingReminder[]): Promise<string | null> {
  if (row.type !== 'indefinite' || row.state !== 'active') {
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

function summary(row: BillingRow, nextDueDate: string | null, counters: BillingCounters, installmentCount?: number): BillingSummary {
  return {
    id: row.id,
    type: row.type,
    frequency: row.frequency,
    description: row.description,
    total: { amountCents: row.total_cents, currency: row.currency },
    startDate: row.start_date,
    endDate: row.end_date,
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
    where: { billing_id: id, state: 'pending' },
    order: { due_date: Order.Asc },
    take: 1
  });

  return rows.records[0];
}

/** The share action prefers a charge that is still due; it only falls back to the overdue one. */
async function shareChargeIdFor(db: DbClient, id: string, today: string, earliest?: { id: string }): Promise<string | null> {
  const rows = await db.charges.findMany({
    select: { id: true },
    where: { billing_id: id, state: 'pending', due_date: { gte: today } },
    order: { due_date: Order.Asc },
    take: 1
  });

  return rows.records[0]?.id ?? earliest?.id ?? null;
}

async function chargeCounters(db: DbClient, id: string): Promise<Pick<BillingCounters, 'chargeCount' | 'paidCount' | 'proofsPending'>> {
  const [row] = await db.rawQuery(
    `SELECT COUNT(*) FILTER (WHERE c.state <> 'cancelled') AS charge_count,
      COUNT(*) FILTER (WHERE c.state = 'paid') AS paid_count,
      (SELECT COUNT(*) FROM payment_proofs p JOIN charges cc ON cc.id = p.charge_id
        WHERE cc.billing_id = :id::uuid AND p.state = 'pending') AS proofs_pending
    FROM charges c WHERE c.billing_id = :id::uuid`,
    { id }
  );

  return {
    chargeCount: Number(row?.['charge_count'] ?? 0),
    paidCount: Number(row?.['paid_count'] ?? 0),
    proofsPending: Number(row?.['proofs_pending'] ?? 0)
  };
}

function installmentCountFor(row: BillingRow): number | undefined {
  if (row.type === 'indefinite') {
    return undefined;
  }

  return billingDueDates({ type: row.type, frequency: row.frequency, startDate: row.start_date, endDate: row.end_date }).length;
}

async function summaryDto(db: DbClient, row: BillingRow, now: Date): Promise<BillingSummary> {
  const today = calendarDate(now, row.timezone);
  const earliest = await earliestPendingCharge(db, row.id);
  const nextDueDate =
    earliest?.due_date ??
    (row.type === 'indefinite' ? ((await previewsFor(db, row, effectiveReminders(row), now))[0]?.occurrenceDate ?? null) : null);
  const participantCount = await db.allocations.count({ where: { billing_id: row.id, kind: 'person' } });
  const shareChargeId = participantCount === 1 ? await shareChargeIdFor(db, row.id, today, earliest) : null;

  return summary(row, nextDueDate, { ...(await chargeCounters(db, row.id)), participantCount, shareChargeId }, installmentCountFor(row));
}

async function dto(db: DbClient, row: BillingRow, now: Date): Promise<BillingDetail> {
  const reminders = effectiveReminders(row);
  const { split, allocations } = await splitFor(db, row.id);
  const charges = await db.charges.findMany({
    select: CHARGE_SELECT,
    where: { billing_id: row.id },
    order: { due_date: Order.Asc, installment: Order.Asc }
  });
  const previews = await previewsFor(db, row, reminders, now);
  const earliest = await earliestPendingCharge(db, row.id);

  // The detail response has its own field list: the card counters stay out of it.
  return {
    id: row.id,
    type: row.type,
    frequency: row.frequency,
    description: row.description,
    total: { amountCents: row.total_cents, currency: row.currency },
    startDate: row.start_date,
    endDate: row.end_date,
    state: row.state,
    installmentCount: installmentCountFor(row),
    nextDueDate: earliest?.due_date ?? previews[0]?.occurrenceDate ?? null,
    createdAt: row.created_at,
    category: row.category,
    invite: null,
    updatedAt: row.updated_at,
    timezone: row.timezone,
    paymentMethodId: row.payment_method_id,
    reminders: parseReminders(row) ?? reminders,
    split,
    allocations,
    charges: await Promise.all(charges.records.map((charge) => chargeDto(db, charge, 'receivable'))),
    previews,
    nextMaterialization: await nextMaterialization(db, row, reminders)
  };
}

async function audit(db: DbClient, ownerId: string, id: string, type: string, now: string, payload: Record<string, unknown> = {}) {
  await db.activity_events.insertOne({
    data: {
      id: crypto.randomUUID(),
      actor_user: { id: ownerId },
      subject_user: { id: ownerId },
      aggregate_type: 'billing',
      aggregate_id: id,
      type,
      payload: JSON.stringify({ billingId: id, ...payload }),
      created_at: now
    }
  });
}

async function saveAllocations(db: DbClient, id: string, totalCents: number, split: BillingSplit, now: string) {
  const resolved = resolveBillingSplit(totalCents, split);

  await db.allocations.deleteMany({ where: { billing_id: id } });

  for (const [index, part] of resolved.entries()) {
    const original = split.parts[index];

    await db.allocations.insertOne({
      data: {
        id: crypto.randomUUID(),
        billing: { id },
        kind: part.kind,
        ...(part.kind === 'person' ? { person: { id: part.personId } } : {}),
        split_mode: split.mode,
        amount_cents: part.amountCents,
        allocation_order: index,
        ...(original && 'basisPoints' in original ? { basis_points: original.basisPoints } : {}),
        // Only the `shares` mode owns the quota column; a stray field on another mode stays null.
        ...(split.mode === 'shares' && original && 'shares' in original ? { shares: original.shares } : {}),
        created_at: now
      }
    });
  }
}

function personIds(split: BillingSplit): string[] {
  return split.parts.flatMap((part) => (part.kind === 'person' ? [part.personId] : []));
}

export async function createBilling(
  db: DbClient,
  ownerId: string,
  key: string,
  raw: BillingInput,
  now = new Date()
): Promise<BillingDetail> {
  if (!key.trim() || key.length > 200) {
    throw new RangeError('Idempotency-Key inválida.');
  }

  const input = normalizeBillingInput(raw);
  const hash = billingRequestFingerprint(input);

  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const existing = await tx.billings.findOne({ select: BILLING_SELECT, where: { owner_id: ownerId, idempotency_key: key } });

    if (existing) {
      if (existing.request_hash !== hash) {
        throw new HttpConflictError('Idempotency-Key já usada com outro conteúdo.');
      }

      return dto(tx, existing, now);
    }

    const today = calendarDate(now, input.timezone);

    if (input.type === 'indefinite' && input.startDate < today) {
      throw new RangeError('O início não pode estar no passado.');
    }

    const context = await prepareChargeMaterialization(tx, ownerId, personIds(input.split), input.paymentMethodId);
    const id = crypto.randomUUID();
    const instant = now.toISOString();
    const row = await tx.billings.insertOne({
      select: BILLING_SELECT,
      data: {
        id,
        owner: { id: ownerId },
        type: input.type,
        frequency: input.frequency ?? sqlNull,
        description: input.description,
        category: input.category ?? 'other',
        total_cents: input.totalCents,
        currency: 'BRL',
        start_date: input.startDate,
        end_date: input.endDate ?? sqlNull,
        timezone: input.timezone,
        ...(input.paymentMethodId ? { payment_method: { id: input.paymentMethodId } } : {}),
        reminders: input.reminders ? JSON.stringify(input.reminders) : sqlNull,
        state: 'active',
        processed_through: input.type === 'indefinite' ? addCalendarDays(today, -1) : sqlNull,
        idempotency_key: key,
        request_hash: hash,
        created_at: instant,
        updated_at: instant
      }
    });

    await saveAllocations(tx, id, input.totalCents, input.split, instant);

    if (input.type !== 'indefinite') {
      const plan = planBillingCharges({
        description: input.description,
        totalCents: input.totalCents,
        split: input.split,
        dueDates: billingDueDates(input),
        numbered: true
      });

      await persistChargePlan(tx, ownerId, plan, { id, type: input.type }, context, instant);
    }

    await audit(tx, ownerId, id, 'billing.created', instant, { type: input.type });

    return dto(tx, row, now);
  });
}

export async function getBilling(db: DbClient, ownerId: string, id: string, now = new Date()): Promise<BillingDetail> {
  return dto(db, await billingRow(db, ownerId, id), now);
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
  filters: BillingFilters,
  cursor: { createdAt: string; id: string } | undefined,
  query: string
): Promise<string[]> {
  const paging = cursor ? 'AND (b.created_at < :createdAt OR (b.created_at = :createdAt AND b.id > :cursorId))' : '';
  const rows = await db.rawQuery(
    `SELECT b.id FROM billings b WHERE b.owner_id = :ownerId::uuid
    AND (:type::text IS NULL OR b.type = :type::text)
    AND (:state::text IS NULL OR b.state = :state::text)
    AND (:category::text IS NULL OR b.category = :category::text)
    AND position(:query::text in lower(b.description)) > 0
    ${paging}
    ORDER BY b.created_at DESC, b.id ASC LIMIT ${PAGE_SIZE + 1}`,
    {
      ownerId,
      type: filters.type ?? null,
      state: filters.state ?? null,
      category: filters.category ?? null,
      ...(cursor ? { createdAt: cursor.createdAt, cursorId: cursor.id } : {}),
      query
    }
  );

  return rows.map((row) => String(row['id']));
}

export async function listBillings(db: DbClient, ownerId: string, filters: BillingFilters = {}, now = new Date()): Promise<BillingsPage> {
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
    select: BILLING_SELECT,
    where: {
      AND: [
        { owner_id: ownerId },
        ...(filters.type ? [{ type: filters.type }] : []),
        ...(filters.state ? [{ state: filters.state }] : []),
        ...(filters.category ? [{ category: filters.category }] : []),
        ...(matchingIds ? [{ id: { isIn: matchingIds } }] : []),
        ...(cursor ? [{ OR: [{ created_at: { lt: cursor.createdAt } }, { created_at: cursor.createdAt, id: { gt: cursor.id } }] }] : [])
      ]
    },
    order: { created_at: Order.Desc, id: Order.Asc },
    take: PAGE_SIZE + 1
  });
  const page = result.records.slice(0, PAGE_SIZE);
  const last = result.records.length > PAGE_SIZE ? page.at(-1) : undefined;

  return {
    billings: await Promise.all(page.map((row) => summaryDto(db, row, now))),
    nextCursor: last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url') : null
  };
}

export async function previewBilling(db: DbClient, ownerId: string, id: string, now = new Date()): Promise<{ previews: BillingPreview[] }> {
  const row = await billingRow(db, ownerId, id);

  if (row.type !== 'indefinite') {
    throw new HttpConflictError('Só cobranças sem fim têm projeção.');
  }

  return { previews: await previewsFor(db, row, effectiveReminders(row), now) };
}

/** Timeline projection: every active indefinite billing of the owner. */
export async function indefinitePreviews(db: DbClient, ownerId: string, now = new Date()): Promise<BillingPreview[]> {
  const rows = await db.billings.findMany({ select: BILLING_SELECT, where: { owner_id: ownerId, type: 'indefinite', state: 'active' } });
  const previews: BillingPreview[] = [];

  for (const row of rows.records) {
    previews.push(...(await previewsFor(db, row, effectiveReminders(row), now)));
  }

  return previews;
}

async function cancelPendingCharges(db: DbClient, ownerId: string, billingId: string, now: string) {
  const pending = await db.charges.findMany({ select: CHARGE_SELECT, where: { billing_id: billingId, state: 'pending' }, lock: true });

  for (const row of pending.records) {
    await closeProofs(db, row, ownerId, 'cancelled', now);
    await db.charges.updateOne({ where: { id: row.id }, data: { state: 'cancelled', cancelled_at: now, updated_at: now } });
    await db.activity_events.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        actor_user: { id: ownerId },
        subject_user: { id: ownerId },
        type: 'charge.cancelled',
        aggregate_type: 'charge',
        aggregate_id: row.id,
        payload: JSON.stringify({ billingId }),
        created_at: now
      }
    });
  }
}

function assertPatchAllowed(row: BillingRow, patch: BillingPatch) {
  if (row.state === 'ended') {
    throw new HttpConflictError('Cobrança encerrada não aceita edição.');
  }

  if (patch.state === 'paused' && row.type !== 'indefinite') {
    throw new HttpConflictError('Só cobranças sem fim podem ser pausadas.');
  }

  const frozen =
    row.type !== 'indefinite' && (patch.description !== undefined || patch.totalCents !== undefined || patch.split !== undefined);

  if (frozen) {
    throw new HttpConflictError('Cobranças já geradas são snapshot: só lembretes, Pix e encerramento podem mudar.');
  }
}

export async function patchBilling(
  db: DbClient,
  ownerId: string,
  id: string,
  patch: BillingPatch,
  now = new Date()
): Promise<BillingDetail> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const row = await billingRow(tx, ownerId, id, true);

    assertPatchAllowed(row, patch);

    const instant = now.toISOString();
    const today = calendarDate(now, row.timezone);
    const totalCents = patch.totalCents ?? row.total_cents;
    const split = patch.split ?? (await splitFor(tx, row.id)).split;
    const paymentMethodId = patch.clearPaymentMethod ? undefined : (patch.paymentMethodId ?? row.payment_method_id);
    const description = patch.description === undefined ? row.description : patch.description.normalize('NFC').trim() || 'Cobrança';
    const reminders =
      patch.reminders === undefined
        ? undefined
        : normalizeBillingInput({ ...billingInputFrom(row, split), reminders: patch.reminders }).reminders;

    // Only newly introduced recipients/Pix need revalidation; materializeBillings re-checks the stored
    // split at occurrence time, so an already-persisted split must not block unrelated edits (e.g. ending
    // a billing whose recipient was archived later).
    if (patch.split !== undefined || patch.paymentMethodId !== undefined || patch.clearPaymentMethod) {
      await prepareChargeMaterialization(tx, ownerId, personIds(split), paymentMethodId);
    }

    if (patch.split !== undefined || patch.totalCents !== undefined) {
      await saveAllocations(tx, id, totalCents, split, instant);
    }

    const resumed = patch.state === 'active' && row.state === 'paused';
    const boundary = addCalendarDays(today, -1);
    const updated = await tx.billings.updateOne({
      select: BILLING_SELECT,
      where: { id },
      data: {
        description,
        category: patch.category ?? row.category,
        total_cents: totalCents,
        payment_method: { id: paymentMethodId ?? sqlNull },
        ...(patch.reminders !== undefined ? { reminders: JSON.stringify(reminders) } : {}),
        ...(patch.state ? { state: patch.state } : {}),
        ...(resumed ? { processed_through: (row.processed_through ?? boundary) > boundary ? row.processed_through : boundary } : {}),
        updated_at: instant
      }
    });

    if (!updated) {
      throw new HttpNotFoundError();
    }

    if (patch.state === 'ended') {
      await cancelPendingCharges(tx, ownerId, id, instant);
    }

    await audit(tx, ownerId, id, patch.state ? `billing.${patch.state}` : 'billing.edited', instant);

    return dto(tx, await billingRow(tx, ownerId, id), now);
  });
}

function billingInputFrom(row: BillingRow, split: BillingSplit): BillingInput {
  return {
    type: row.type,
    frequency: row.frequency,
    description: row.description,
    totalCents: row.total_cents,
    startDate: row.start_date,
    endDate: row.end_date,
    timezone: row.timezone,
    paymentMethodId: row.payment_method_id,
    split,
    category: row.category
  };
}

/** Hourly job for `indefinite` billings until slice 2 moves it to the queue consumer. */
export async function materializeBillings(db: DbClient, now = new Date()): Promise<{ materialized: number; failures: string[] }> {
  const candidates = (
    await db.billings.findMany({
      select: { id: true, owner_id: true },
      where: { type: 'indefinite', state: 'active' },
      order: { id: Order.Asc }
    })
  ).records;
  const failures: string[] = [];

  let materialized = 0;
  let evaluated = 0;

  for (const candidate of candidates) {
    if (evaluated >= MATERIALIZATION_BUDGET) {
      break;
    }

    try {
      const result = await db.transaction(async (tx) => {
        await lockOwner(tx, candidate.owner_id);

        const row = await billingRow(tx, candidate.owner_id, candidate.id, true);

        if (row.state !== 'active' || row.type !== 'indefinite') {
          return { created: 0, evaluated: 0 };
        }

        const reminders = effectiveReminders(row);
        const offsets = reminders.filter((reminder) => reminder.enabled).map((reminder) => reminder.offsetDays);
        const today = calendarDate(now, row.timezone);
        const latest = addCalendarDays(today, -(offsets.length ? Math.min(...offsets) : 0));
        const cursor = row.processed_through ?? addCalendarDays(row.start_date, -1);
        const dates = billingDates(calendarRule(row), addCalendarDays(cursor, 1), latest, 1);

        let created = 0;

        for (const dueDate of dates) {
          evaluated++;

          const exists = await tx.charges.count({ where: { billing_id: row.id, due_date: dueDate } });

          if (!exists) {
            const { split } = await splitFor(tx, row.id);
            const context = await prepareChargeMaterialization(tx, row.owner_id, personIds(split), row.payment_method_id);
            const plan = planBillingCharges({
              description: row.description,
              totalCents: row.total_cents,
              split,
              dueDates: [dueDate],
              numbered: false
            });
            const instant = now.toISOString();

            await persistChargePlan(tx, row.owner_id, plan, { id: row.id, type: 'indefinite' }, context, instant);
            await audit(tx, row.owner_id, row.id, 'billing.materialized', instant, { dueDate });

            created++;
          }

          await tx.billings.updateOne({ where: { id: row.id }, data: { processed_through: dueDate, updated_at: now.toISOString() } });
        }

        return { created, evaluated: dates.length };
      });

      materialized += result.created;
    } catch (error) {
      // A stale archived recipient/Pix must not starve unrelated billings; its cursor stays put.
      if (!(error instanceof HttpNotFoundError)) {
        throw error;
      }

      failures.push(candidate.id);
    }
  }

  return { materialized, failures };
}
