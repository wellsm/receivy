import { createHash } from "node:crypto";
import { Order } from "@ez4/database";
import { HttpConflictError, HttpNotFoundError, HttpUnauthorizedError } from "@ez4/gateway";
import { addCalendarDays, calendarDate, materializationDate, normalizeRecurrenceInput, planExpenseCharges, recurrenceDates,
  type ExpenseSplit, type RecurrenceDetail, type RecurrenceInput, type RecurrencePreview } from "@receivy/common";
import type { DbClient } from "../database";
import { lockAccountReferences } from "../account/locking";
import { prepareChargeMaterialization, persistChargePlan } from "../expenses/repository";

const SELECT = { id: true, owner_id: true, description: true, total_cents: true, frequency: true, day: true, month: true,
  start_date: true, end_date: true, timezone: true, payment_method_id: true, state: true, processed_through: true, last_attempted_at: true,
  idempotency_key: true, request_hash: true, created_at: true, updated_at: true } as const;
type RuleRow = { id: string; owner_id: string; description: string; total_cents: number; frequency: "monthly" | "yearly";
  day: number; month?: number; start_date: string; end_date?: string; timezone: string; payment_method_id?: string;
  state: "active" | "paused" | "ended"; processed_through: string; request_hash: string; created_at: string; updated_at: string };

// All recurrence mutations follow expense lock order: owner → rule → people → Pix.
async function lockOwner(db: DbClient, ownerId: string) {
  await lockAccountReferences(db, "write");
  if (!await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true })) throw new HttpUnauthorizedError();
}
async function ruleRow(db: DbClient, ownerId: string, id: string, lock = false) {
  const row = await db.recurrences.findOne({ select: SELECT, where: { id, owner_id: ownerId }, lock });
  if (!row) throw new HttpNotFoundError();
  return row;
}
async function ruleInput(db: DbClient, row: RuleRow): Promise<RecurrenceInput & { startDate: string; description: string; reminders: NonNullable<RecurrenceInput["reminders"]> }> {
  const allocations = (await db.recurrence_allocations.findMany({ select: { kind: true, person_id: true, split_mode: true,
    amount_cents: true, basis_points: true }, where: { recurrence_id: row.id }, order: { allocation_order: Order.Asc } })).records;
  const mode = allocations[0]?.split_mode ?? "equal";
  const parties = allocations.map(a => a.kind === "owner" ? { kind: "owner" as const } : { kind: "person" as const, personId: a.person_id! });
  const split: ExpenseSplit = mode === "fixed" ? { mode, parts: allocations.flatMap(a => a.kind === "person" ? [{ kind: "person" as const, personId: a.person_id!, amountCents: a.amount_cents }] : []) }
    : mode === "equal" ? { mode, parts: parties } : { mode, parts: parties.map((p, i) => ({ ...p, basisPoints: allocations[i]!.basis_points! })) };
  const reminders = (await db.recurrence_reminders.findMany({ select: { offset_days: true, channel: true, enabled: true },
    where: { recurrence_id: row.id }, order: { offset_days: Order.Asc } })).records.map(r => ({ offsetDays: r.offset_days, channel: r.channel, enabled: r.enabled }));
  return { description: row.description, totalCents: row.total_cents, frequency: row.frequency, day: row.day, month: row.month ?? undefined,
    startDate: row.start_date, endDate: row.end_date ?? undefined, timezone: row.timezone, paymentMethodId: row.payment_method_id ?? undefined, split, reminders };
}
async function previews(db: DbClient, row: RuleRow, input: Awaited<ReturnType<typeof ruleInput>>, now: Date): Promise<RecurrencePreview[]> {
  if (row.state !== "active") return [];
  const today = calendarDate(now, row.timezone);
  const dates = recurrenceDates(input, today, addCalendarDays(today, 90));
  const existing = (await db.recurrence_occurrences.findMany({ select: { occurrence_date: true }, where: { recurrence_id: row.id,
    occurrence_date: { gte: today } } })).records.map(r => r.occurrence_date);
  const plan = planExpenseCharges({ ...input, installmentCount: 1, firstDueDate: input.startDate });
  const external = plan.charges.reduce((sum, c) => sum + c.amountCents, 0);
  return dates.filter(d => !existing.includes(d) && d > row.processed_through).map(occurrenceDate => ({ recurrenceId: row.id,
    description: row.description, amount: { amountCents: external, currency: "BRL" }, occurrenceDate,
    materializationDate: materializationDate(occurrenceDate, input.reminders) }));
}
async function dto(db: DbClient, row: RuleRow, now: Date): Promise<RecurrenceDetail> {
  const input = await ruleInput(db, row);
  const projected = await previews(db, row, input, now);
  const existing = row.state === "active" ? (await db.recurrence_occurrences.findMany({ select: { occurrence_date: true },
    where: { recurrence_id: row.id, occurrence_date: { gt: row.processed_through } } })).records.map(r => r.occurrence_date) : [];
  const next = row.state === "active" ? recurrenceDates(input, addCalendarDays(row.processed_through, 1), "9999-12-31", existing.length + 1)
    .find(date => !existing.includes(date)) : undefined;
  return { ...input, id: row.id, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
    nextMaterialization: next ? materializationDate(next, input.reminders) : null, previews: projected };
}
async function audit(db: DbClient, ownerId: string, id: string, type: string, now: string) {
  await db.activity_events.insertOne({ data: { id: crypto.randomUUID(), actor_user: { id: ownerId }, subject_user: { id: ownerId },
    aggregate_type: "recurrence", aggregate_id: id, type, payload: JSON.stringify({ recurrenceId: id }), created_at: now } });
}
async function saveParts(db: DbClient, id: string, input: ReturnType<typeof normalizeRecurrenceInput> & { startDate: string }) {
  const plan = planExpenseCharges({ ...input, installmentCount: 1, firstDueDate: input.startDate });
  await db.recurrence_allocations.deleteMany({ where: { recurrence_id: id } });
  await db.recurrence_reminders.deleteMany({ where: { recurrence_id: id } });
  for (const [index, part] of plan.allocations.entries()) {
    const original = input.split.parts[index];
    await db.recurrence_allocations.insertOne({ data: { id: crypto.randomUUID(), recurrence: { id }, kind: part.kind,
      ...(part.kind === "person" ? { person: { id: part.personId } } : {}), split_mode: input.split.mode,
      amount_cents: part.amountCents, allocation_order: index,
      ...(original && "basisPoints" in original ? { basis_points: original.basisPoints } : {}) } });
  }
  for (const reminder of input.reminders) await db.recurrence_reminders.insertOne({ data: { id: crypto.randomUUID(), recurrence: { id },
    offset_days: reminder.offsetDays, channel: reminder.channel, enabled: reminder.enabled } });
}
// EZ4 0.52 optional-field typings omit SQL NULL; explicit null clears old values.
const sqlNull = null as unknown as undefined;
function fields(input: ReturnType<typeof normalizeRecurrenceInput> & { startDate: string }) {
  return { description: input.description, total_cents: input.totalCents, frequency: input.frequency, day: input.day,
    month: input.month ?? sqlNull, start_date: input.startDate, end_date: input.endDate ?? sqlNull, timezone: input.timezone,
    payment_method_id: input.paymentMethodId ?? sqlNull };
}
async function validateParties(db: DbClient, ownerId: string, input: RecurrenceInput) {
  await prepareChargeMaterialization(db, ownerId, input.split.parts.flatMap(p => p.kind === "person" ? [p.personId] : []), input.paymentMethodId);
}
export async function createRecurrence(db: DbClient, ownerId: string, key: string, raw: RecurrenceInput, now = new Date()): Promise<RecurrenceDetail> {
  if (!key.trim() || key.length > 200) throw new RangeError("Idempotency-Key inválida.");
  const normalized = normalizeRecurrenceInput(raw);
  const canonical = JSON.stringify(normalized, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  const hash = createHash("sha256").update(canonical).digest("base64url");
  return db.transaction(async tx => {
    await lockOwner(tx, ownerId);
    const existing = await tx.recurrences.findOne({ select: SELECT, where: { owner_id: ownerId, idempotency_key: key } });
    if (existing) { if (existing.request_hash !== hash) throw new HttpConflictError("Idempotency-Key já usada com outro conteúdo."); return dto(tx, existing, now); }
    const today = calendarDate(now, normalized.timezone);
    const input = { ...normalized, startDate: normalized.startDate ?? today };
    if (input.startDate < today) throw new RangeError("O início não pode estar no passado.");
    if (input.endDate && input.endDate < input.startDate) throw new RangeError("Fim anterior ao início.");
    await validateParties(tx, ownerId, input);
    const id = crypto.randomUUID(); const instant = now.toISOString();
    const row = await tx.recurrences.insertOne({ select: SELECT, data: { ...fields(input), id, owner: { id: ownerId }, currency: "BRL",
      state: "active", processed_through: addCalendarDays(today, -1), idempotency_key: key, request_hash: hash, created_at: instant, updated_at: instant } });
    await saveParts(tx, id, input); await audit(tx, ownerId, id, "recurrence.created", instant);
    return dto(tx, row, now);
  });
}
export async function getRecurrence(db: DbClient, ownerId: string, id: string, now = new Date()) { return dto(db, await ruleRow(db, ownerId, id), now); }
export async function listRecurrences(db: DbClient, ownerId: string, now = new Date()) {
  const rows = await db.recurrences.findMany({ select: SELECT, where: { owner_id: ownerId }, order: { created_at: Order.Desc } });
  return Promise.all(rows.records.map(row => dto(db, row, now)));
}
export async function editRecurrence(db: DbClient, ownerId: string, id: string, raw: RecurrenceInput, now = new Date()) {
  const normalized = normalizeRecurrenceInput(raw);
  return db.transaction(async tx => {
    await lockOwner(tx, ownerId); const row = await ruleRow(tx, ownerId, id, true);
    if (row.state === "ended") throw new HttpConflictError("Recorrência encerrada.");
    const input = { ...normalized, startDate: normalized.startDate ?? row.start_date };
    const today = calendarDate(now, input.timezone);
    if (input.startDate !== row.start_date && input.startDate < today) throw new RangeError("O novo início não pode estar no passado.");
    if (input.endDate && input.endDate < input.startDate) throw new RangeError("Fim anterior ao início.");
    await validateParties(tx, ownerId, input);
    // Rewind a future reminder cursor so changing Jan31 → Jan30 does not skip Jan30.
    // Retain an older cursor: active outage backlog is not erased by edits.
    const boundary = addCalendarDays(today, -1);
    const updated = await tx.recurrences.updateOne({ select: SELECT, where: { id }, data: { ...fields(input),
      processed_through: row.processed_through < boundary ? row.processed_through : boundary, updated_at: now.toISOString() } });
    await saveParts(tx, id, input); await audit(tx, ownerId, id, "recurrence.edited", now.toISOString());
    if (!updated) throw new HttpNotFoundError();
    return dto(tx, await ruleRow(tx, ownerId, id), now);
  });
}
export async function transitionRecurrence(db: DbClient, ownerId: string, id: string, state: RecurrenceDetail["state"], now = new Date()) {
  return db.transaction(async tx => {
    await lockOwner(tx, ownerId); const row = await ruleRow(tx, ownerId, id, true);
    if (row.state === state) return dto(tx, row, now);
    if (row.state === "ended") throw new HttpConflictError("Recorrência encerrada.");
    const boundary = addCalendarDays(calendarDate(now, row.timezone), -1);
    const updated = await tx.recurrences.updateOne({ select: SELECT, where: { id }, data: { state, updated_at: now.toISOString(),
      ...(state === "active" ? { processed_through: row.processed_through > boundary ? row.processed_through : boundary } : {}) } });
    if (!updated) throw new HttpNotFoundError();
    await audit(tx, ownerId, id, `recurrence.${state}`, now.toISOString()); return dto(tx, await ruleRow(tx, ownerId, id), now);
  });
}
export async function materializeRecurrences(db: DbClient, now = new Date()): Promise<{ materialized: number; failures: string[] }> {
  const candidates = (await db.recurrences.findMany({ select: { id: true, owner_id: true, last_attempted_at: true }, where: { state: "active" }, order: { id: Order.Asc } })).records;
  candidates.sort((a, b) => (a.last_attempted_at ?? "").localeCompare(b.last_attempted_at ?? "") || a.id.localeCompare(b.id));
  const queue = [...candidates];
  const instant = now.toISOString();
  let materialized = 0; let evaluated = 0; const failures: string[] = [];
  while (queue.length && evaluated < 100) {
    const candidate = queue.shift()!;
    let attempted = false;
    try {
      const result = await db.transaction(async tx => {
        await lockOwner(tx, candidate.owner_id); const row = await ruleRow(tx, candidate.owner_id, candidate.id, true);
        if (row.state !== "active") return { created: 0, evaluated: 0 };
        const input = await ruleInput(tx, row); const today = calendarDate(now, row.timezone);
        const offset = input.reminders.filter(r => r.enabled).map(r => r.offsetDays);
        const latest = addCalendarDays(today, -(offset.length ? Math.min(...offset) : 0));
        const dates = recurrenceDates(input, addCalendarDays(row.processed_through, 1), latest, 1);
        let created = 0;
        for (const dueDate of dates) {
          // Count before work: rollback must not restore the invocation budget.
          attempted = true; evaluated++;
          const existing = await tx.recurrence_occurrences.findOne({ select: { id: true }, where: { recurrence_id: row.id, occurrence_date: dueDate } });
          if (!existing) {
            const context = await prepareChargeMaterialization(tx, row.owner_id, input.split.parts.flatMap(p => p.kind === "person" ? [p.personId] : []), input.paymentMethodId);
            const id = crypto.randomUUID(); const instant = now.toISOString();
            await tx.recurrence_occurrences.insertOne({ data: { id, recurrence: { id: row.id }, occurrence_date: dueDate,
              materialized_at: instant, reminders_json: JSON.stringify(input.reminders), timezone: row.timezone } });
            const plan = planExpenseCharges({ ...input, installmentCount: 1, firstDueDate: dueDate });
            await persistChargePlan(tx, row.owner_id, plan, { source: "recurrence", sourceId: row.id, occurrenceId: id }, context, instant);
            await tx.activity_events.insertOne({ data: { id: crypto.randomUUID(), actor_user: { id: row.owner_id }, subject_user: { id: row.owner_id },
              type: "recurrence.materialized", aggregate_type: "recurrence_occurrence", aggregate_id: id,
              payload: JSON.stringify({ recurrenceId: row.id, occurrenceId: id, dueDate }), created_at: instant } });
            await tx.outbox_events.insertOne({ data: { id: crypto.randomUUID(), type: "recurrence.materialized", aggregate_type: "recurrence_occurrence",
              aggregate_id: id, payload: JSON.stringify({ recurrenceId: row.id, occurrenceId: id, dueDate, timezone: row.timezone, reminders: input.reminders }),
              state: "pending", attempts: 0, available_at: instant, created_at: instant, updated_at: instant } });
            created++;
          }
          await tx.recurrences.updateOne({ where: { id: row.id }, data: { processed_through: dueDate,
            last_attempted_at: row.last_attempted_at && row.last_attempted_at > instant ? row.last_attempted_at : instant } });
        }
        return { created, evaluated: dates.length };
      });
      materialized += result.created;
      if (result.evaluated) queue.push(candidate);
    } catch (error) {
      // A stale archived recipient/Pix must not starve unrelated rules; retain its cursor.
      if (!(error instanceof HttpNotFoundError)) throw error;
      failures.push(candidate.id);
      if (attempted) {
        // Financial work rolled back; separately record only operational fairness.
        // Re-lock and compare against current data so an older concurrent run
        // cannot regress a newer attempt timestamp or overwrite financial progress.
        await db.transaction(async tx => {
          await lockOwner(tx, candidate.owner_id);
          const row = await ruleRow(tx, candidate.owner_id, candidate.id, true);
          if (!row.last_attempted_at || row.last_attempted_at < instant) {
            await tx.recurrences.updateOne({ where: { id: row.id }, data: { last_attempted_at: instant } });
          }
        });
      }
    }
  }
  return { materialized, failures };
}
