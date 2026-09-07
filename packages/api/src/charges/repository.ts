import { HttpConflictError, HttpForbiddenError, HttpNotFoundError } from "@ez4/gateway";
import type { ChargeDetail, PaymentRecord } from "@receivy/common";
import type { DbClient } from "../database";
import { lockAccountReferences } from "../account/locking";
import { closeProofs } from "../proofs/events";

export const CHARGE_SELECT = {
  id: true, creditor_id: true, debtor_person_id: true, recipient_user_id: true, recipient_name_snapshot: true,
  recipient_email_snapshot: true, source: true, source_id: true, source_occurrence_id: true, description: true,
  amount_cents: true, currency: true, due_date: true, installment: true, installment_count: true,
  pix_key_type_snapshot: true, pix_key_snapshot: true, pix_label_snapshot: true, state: true,
  cancelled_at: true, paid_at: true, created_at: true, updated_at: true,
} as const;

export type ChargeRow = {
  id: string; creditor_id: string; debtor_person_id: string; recipient_user_id?: string;
  recipient_name_snapshot: string; recipient_email_snapshot?: string; source: "expense" | "recurrence";
  source_id: string; source_occurrence_id?: string; description: string; amount_cents: number; currency: "BRL";
  due_date: string; installment: number; installment_count: number;
  pix_key_type_snapshot?: "cpf" | "cnpj" | "email" | "phone" | "random"; pix_key_snapshot?: string;
  pix_label_snapshot?: string; state: "pending" | "paid" | "cancelled"; cancelled_at?: string; paid_at?: string;
  created_at: string; updated_at: string;
};

async function paymentFor(db: DbClient, chargeId: string): Promise<PaymentRecord | null> {
  const row = await db.payments.findOne({ select: { id: true, charge_id: true, amount_cents: true, currency: true,
    method: true, paid_at: true, created_at: true }, where: { charge_id: chargeId } });
  return row ? { id: row.id, chargeId: row.charge_id, amount: { amountCents: row.amount_cents, currency: row.currency },
    method: row.method, paidAt: row.paid_at, createdAt: row.created_at } : null;
}

export async function chargeDto(db: DbClient, row: ChargeRow, direction: "receivable" | "payable"): Promise<ChargeDetail> {
  return {
    id: row.id, description: row.description, amount: { amountCents: row.amount_cents, currency: row.currency },
    dueDate: row.due_date, state: row.state, source: row.source, installment: row.installment,
    installmentCount: row.installment_count, direction,
    recipient: { name: row.recipient_name_snapshot, email: row.recipient_email_snapshot ?? null },
    sharingState: row.state !== "pending" ? "closed" : row.pix_key_snapshot && row.pix_key_type_snapshot ? "ready" : await db.public_links.count({ where: { charge_id: row.id } }) ? "legacy_without_pix" : "pix_required",
    pix: row.pix_key_type_snapshot && row.pix_key_snapshot ? { keyType: row.pix_key_type_snapshot,
      key: row.pix_key_snapshot, label: row.pix_label_snapshot ?? "Pix" } : null,
    payment: await paymentFor(db, row.id), cancelledAt: row.cancelled_at ?? null, paidAt: row.paid_at ?? null,
    createdAt: row.created_at,
  };
}

async function actorEmail(db: DbClient, actorId: string): Promise<string | undefined> {
  const user = await db.users.findOne({ select: { verified_email: true }, where: { id: actorId } });
  return user?.verified_email;
}

export async function findChargeForActor(db: DbClient, actorId: string, id: string, lock = false): Promise<{ row: ChargeRow; direction: "receivable" | "payable" }> {
  if (lock) await lockAccountReferences(db, "write");
  if (!await db.users.findOne({ select: { id: true }, where: { id: actorId, deleted_at: { isNull: true } }, ...(lock ? { lock: true } : {}) })) throw new HttpForbiddenError();
  const row = await db.charges.findOne({ select: CHARGE_SELECT, where: { id }, ...(lock ? { lock: true } : {}) });
  if (!row) throw new HttpNotFoundError();
  if (row.creditor_id === actorId) return { row, direction: "receivable" };
  const email = await actorEmail(db, actorId);
  if (row.recipient_user_id === actorId || (!!email && row.recipient_email_snapshot === email)) {
    return { row, direction: "payable" };
  }
  throw new HttpForbiddenError();
}

export async function getCharge(db: DbClient, actorId: string, id: string): Promise<ChargeDetail> {
  const { row, direction } = await findChargeForActor(db, actorId, id);
  return chargeDto(db, row, direction);
}

async function activity(db: DbClient, input: { actorId: string; row: ChargeRow; type: string; now: string }) {
  const subjects = new Set([input.row.creditor_id, input.row.recipient_user_id].filter((id): id is string => !!id));
  if (!subjects.size) subjects.add(input.row.creditor_id);
  for (const subjectId of subjects) await db.activity_events.insertOne({ select: { id: true }, data: {
    id: crypto.randomUUID(), actor_user: { id: input.actorId }, subject_user: { id: subjectId }, type: input.type,
    aggregate_type: "charge", aggregate_id: input.row.id, payload: "{}", created_at: input.now,
  } });
}

export async function cancelCharge(db: DbClient, creditorId: string, id: string): Promise<ChargeDetail> {
  return db.transaction(async tx => {
    const { row, direction } = await findChargeForActor(tx, creditorId, id, true);
    if (direction !== "receivable") throw new HttpForbiddenError();
    if (row.state === "cancelled") return chargeDto(tx, row, direction);
    if (row.state !== "pending") throw new HttpConflictError("A cobrança já foi encerrada.");
    const now = new Date().toISOString();
    await closeProofs(tx, row, creditorId, "cancelled", now);
    const changed = await tx.charges.updateOne({ select: { id: true }, where: { id },
      data: { state: "cancelled", cancelled_at: now, updated_at: now } });
    if (!changed) throw new HttpNotFoundError();
    const updated = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id } });
    if (!updated) throw new HttpNotFoundError();
    await activity(tx, { actorId: creditorId, row: updated, type: "charge.cancelled", now });
    return chargeDto(tx, updated, direction);
  });
}

export async function recordManualPayment(db: DbClient, creditorId: string, id: string,
  input: { method: PaymentRecord["method"]; paidAt?: string }): Promise<ChargeDetail> {
  return db.transaction(async tx => {
    const { row, direction } = await findChargeForActor(tx, creditorId, id, true);
    if (direction !== "receivable") throw new HttpForbiddenError();
    if (row.state !== "pending") throw new HttpConflictError("A cobrança já foi encerrada.");
    const now = new Date().toISOString();
    const paidAt = input.paidAt ?? now;
    await closeProofs(tx, row, creditorId, "paid", now);
    await tx.payments.insertOne({ select: { id: true }, data: { id: crypto.randomUUID(), charge: { id: row.id },
      amount_cents: row.amount_cents, currency: row.currency, method: input.method, registered_by: { id: creditorId },
      paid_at: paidAt, created_at: now } });
    const changed = await tx.charges.updateOne({ select: { id: true }, where: { id },
      data: { state: "paid", paid_at: paidAt, updated_at: now } });
    if (!changed) throw new HttpNotFoundError();
    const updated = await tx.charges.findOne({ select: CHARGE_SELECT, where: { id } });
    if (!updated) throw new HttpNotFoundError();
    await activity(tx, { actorId: creditorId, row: updated, type: "charge.paid", now });
    return chargeDto(tx, updated, direction);
  });
}
