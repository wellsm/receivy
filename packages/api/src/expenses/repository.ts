import { Order } from "@ez4/database";
import { HttpConflictError, HttpNotFoundError, HttpUnauthorizedError } from "@ez4/gateway";
import { planExpenseCharges, type ExpenseDetail, type ExpenseInput, type ExpensePlan, type PaymentMethod } from "@receivy/common";
import type { DbClient } from "../database";
import { CHARGE_SELECT, chargeDto, type ChargeRow } from "../charges/repository";
import { expenseRequestFingerprint, normalizeExpenseInput } from "./request";

const EXPENSE_SELECT = { id: true, owner_id: true, type: true, description: true, total_cents: true, currency: true,
  installment_count: true, first_due_date: true, payment_method_id: true, idempotency_key: true, request_hash: true,
  created_at: true, updated_at: true } as const;

export type MaterializationSource = { source: "expense" | "recurrence"; sourceId: string; occurrenceId?: string };
export type ChargeRecipientMaterialization = { personId: string; name: string; email?: string; linkedUserId?: string };
export type ChargeMaterializationContext = {
  recipients: Map<string, ChargeRecipientMaterialization>;
  pix: { keyType: PaymentMethod["pixKeyType"]; key: string; label: string } | null;
};

async function lockOwner(db: DbClient, ownerId: string) {
  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId }, lock: true });
  if (!owner) throw new HttpUnauthorizedError();
}

async function recipientSnapshots(db: DbClient, ownerId: string, personIds: string[]): Promise<Map<string, ChargeRecipientMaterialization>> {
  const result = new Map<string, ChargeRecipientMaterialization>();
  for (const personId of new Set(personIds)) {
    const row = await db.people.findOne({ select: { id: true, owner_id: true, linked_user_id: true, name: true, active_email: true, archived_at: true },
      where: { id: personId, owner_id: ownerId }, lock: true });
    if (!row || row.archived_at) throw new HttpNotFoundError("Contato indisponível.");
    result.set(personId, { personId: row.id, name: row.name, email: row.active_email, linkedUserId: row.linked_user_id });
  }
  return result;
}

async function pixSnapshot(db: DbClient, ownerId: string, paymentMethodId?: string): Promise<ChargeMaterializationContext["pix"]> {
  if (paymentMethodId) {
    const row = await db.payment_methods.findOne({ select: { pix_key_type: true, pix_key: true, label: true, archived_at: true },
      where: { id: paymentMethodId, owner_id: ownerId }, lock: true });
    if (!row || row.archived_at) throw new HttpNotFoundError("Chave Pix indisponível.");
    return { keyType: row.pix_key_type, key: row.pix_key, label: row.label };
  }
  const { records } = await db.payment_methods.findMany({ select: { pix_key_type: true, pix_key: true, label: true },
    where: { owner_id: ownerId, is_default: true, archived_at: { isNull: true } }, take: 1 });
  const row = records[0];
  return row ? { keyType: row.pix_key_type, key: row.pix_key, label: row.label } : null;
}

/** Validates owner-scoped people/payment method and captures values before materialization. */
export async function prepareChargeMaterialization(db: DbClient, ownerId: string, personIds: string[],
  paymentMethodId?: string): Promise<ChargeMaterializationContext> {
  return { recipients: await recipientSnapshots(db, ownerId, personIds), pix: await pixSnapshot(db, ownerId, paymentMethodId) };
}

/** Shared persistence seam for expense and recurrence materializers. Caller owns the transaction. */
export async function persistChargePlan(db: DbClient, ownerId: string, plan: ExpensePlan, source: MaterializationSource,
  context: ChargeMaterializationContext, now: string): Promise<ChargeRow[]> {
  const rows: ChargeRow[] = [];
  for (const item of plan.charges) {
    const recipient = context.recipients.get(item.personId);
    if (!recipient) throw new HttpNotFoundError("Contato indisponível.");
    const row = await db.charges.insertOne({ select: CHARGE_SELECT, data: {
      id: crypto.randomUUID(), creditor: { id: ownerId }, debtor_person: { id: recipient.personId },
      ...(recipient.linkedUserId ? { recipient_user: { id: recipient.linkedUserId } } : {}),
      recipient_name_snapshot: recipient.name, ...(recipient.email ? { recipient_email_snapshot: recipient.email } : {}),
      source: source.source, source_id: source.sourceId, ...(source.occurrenceId ? { source_occurrence_id: source.occurrenceId } : {}),
      description: item.description, amount_cents: item.amountCents, currency: item.currency, due_date: item.dueDate,
      installment: item.installment, installment_count: item.installmentCount,
      ...(context.pix ? { pix_key_type_snapshot: context.pix.keyType, pix_key_snapshot: context.pix.key, pix_label_snapshot: context.pix.label } : {}),
      state: "pending", created_at: now, updated_at: now,
    } });
    rows.push(row);
    const payload = JSON.stringify({ chargeId: row.id, source: row.source });
    await db.activity_events.insertOne({ select: { id: true }, data: { id: crypto.randomUUID(), actor_user: { id: ownerId },
      subject_user: { id: ownerId }, type: "charge.created", aggregate_type: "charge", aggregate_id: row.id, payload, created_at: now } });
    if (recipient.linkedUserId) await db.activity_events.insertOne({ select: { id: true }, data: { id: crypto.randomUUID(),
      actor_user: { id: ownerId }, subject_user: { id: recipient.linkedUserId }, type: "charge.created", aggregate_type: "charge",
      aggregate_id: row.id, payload, created_at: now } });
    await db.outbox_events.insertOne({ select: { id: true }, data: { id: crypto.randomUUID(), type: "charge.created",
      aggregate_type: "charge", aggregate_id: row.id, ...(recipient.linkedUserId ? { recipient_user: { id: recipient.linkedUserId } } : {}),
      ...(recipient.email ? { recipient_email: recipient.email } : {}), payload, state: "pending", attempts: 0,
      available_at: now, created_at: now, updated_at: now } });
  }
  return rows;
}

async function expenseDto(db: DbClient, row: {
  id: string; type: "one_time" | "installment"; description: string; total_cents: number; currency: "BRL";
  installment_count: number; first_due_date: string; created_at: string;
}): Promise<ExpenseDetail> {
  const allocations = await db.expense_allocations.findMany({ select: { person_id: true, kind: true, split_mode: true,
    amount_cents: true, allocation_order: true }, where: { expense_id: row.id }, order: { allocation_order: Order.Asc } });
  const charges = await db.charges.findMany({ select: CHARGE_SELECT, where: { source: "expense", source_id: row.id },
    order: { due_date: Order.Asc, installment: Order.Asc } });
  return {
    id: row.id, type: row.type, description: row.description, total: { amountCents: row.total_cents, currency: row.currency },
    installmentCount: row.installment_count, firstDueDate: row.first_due_date,
    allocations: allocations.records.map(allocation => ({ kind: allocation.kind, personId: allocation.person_id ?? null,
      splitMode: allocation.split_mode, amount: { amountCents: allocation.amount_cents, currency: "BRL" }, order: allocation.allocation_order })),
    charges: await Promise.all(charges.records.map(charge => chargeDto(db, charge, "receivable"))), createdAt: row.created_at,
  };
}

export async function getExpense(db: DbClient, ownerId: string, id: string): Promise<ExpenseDetail> {
  const row = await db.expenses.findOne({ select: EXPENSE_SELECT, where: { id, owner_id: ownerId } });
  if (!row) throw new HttpNotFoundError();
  return expenseDto(db, row);
}

export async function createExpense(db: DbClient, ownerId: string, idempotencyKey: string, input: ExpenseInput): Promise<ExpenseDetail> {
  if (!idempotencyKey.trim() || idempotencyKey.length > 200) throw new RangeError("Idempotency-Key inválida.");
  const normalized = normalizeExpenseInput(input);
  const requestHash = expenseRequestFingerprint(normalized);
  const plan = planExpenseCharges(normalized);
  return db.transaction(async tx => {
    await lockOwner(tx, ownerId);
    const existing = await tx.expenses.findOne({ select: EXPENSE_SELECT,
      where: { owner_id: ownerId, idempotency_key: idempotencyKey } });
    if (existing) {
      if (existing.request_hash !== requestHash) throw new HttpConflictError("Idempotency-Key já usada com outro conteúdo.");
      return expenseDto(tx, existing);
    }
    const personIds = plan.allocations.flatMap(allocation => allocation.kind === "person" ? [allocation.personId] : []);
    const materialization = await prepareChargeMaterialization(tx, ownerId, personIds, normalized.paymentMethodId);
    const now = new Date().toISOString();
    const expenseId = crypto.randomUUID();
    const row = await tx.expenses.insertOne({ select: EXPENSE_SELECT, data: { id: expenseId, owner: { id: ownerId },
      type: normalized.installmentCount === 1 ? "one_time" : "installment", description: plan.description,
      total_cents: plan.totalCents, currency: "BRL", installment_count: normalized.installmentCount,
      first_due_date: normalized.firstDueDate, ...(normalized.paymentMethodId ? { payment_method: { id: normalized.paymentMethodId } } : {}),
      idempotency_key: idempotencyKey, request_hash: requestHash, created_at: now, updated_at: now } });
    for (const [index, allocation] of plan.allocations.entries()) {
      const original = normalized.split.parts[index];
      await tx.expense_allocations.insertOne({ select: { id: true }, data: { id: crypto.randomUUID(), expense: { id: expenseId },
        ...(allocation.kind === "person" ? { person: { id: allocation.personId } } : {}), kind: allocation.kind,
        split_mode: normalized.split.mode,
        ...(normalized.split.mode === "percentage" && original && "basisPoints" in original ? { basis_points: original.basisPoints } : {}),
        amount_cents: allocation.amountCents, allocation_order: index, created_at: now } });
    }
    await persistChargePlan(tx, ownerId, plan, { source: "expense", sourceId: expenseId }, materialization, now);
    return expenseDto(tx, row);
  });
}
