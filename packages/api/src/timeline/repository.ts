import { Order } from "@ez4/database";
import { HttpNotFoundError, HttpUnprocessableEntityError } from "@ez4/gateway";
import type { ChargeState, Direction, PersonLedger, TimelinePage, TimelineItem } from "@receivy/common";
import type { DbClient } from "../database";
import { getPerson } from "../people/repository";
import { CHARGE_SELECT, chargeDto, type ChargeRow } from "../charges/repository";
import { listRecurrences } from "../recurrences/repository";

export type TimelineFilters = {
  cursor?: string;
  direction?: Direction;
  status?: ChargeState | "overdue";
  source?: "expense" | "recurrence";
  from?: string;
  to?: string;
};

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const OVERFLOW_MESSAGE = "O total financeiro deve estar entre -9007199254740991 e 9007199254740991 centavos.";

function money(amountCents: bigint | number) {
  const exact = typeof amountCents === "bigint"
    ? amountCents
    : Number.isSafeInteger(amountCents) ? BigInt(amountCents) : MAX_SAFE_CENTS + 1n;
  if (exact < -MAX_SAFE_CENTS || exact > MAX_SAFE_CENTS) {
    throw new HttpUnprocessableEntityError(OVERFLOW_MESSAGE);
  }
  return { amountCents: Number(exact), currency: "BRL" as const };
}

function sum(rows: ChargeRow[]): bigint {
  return rows.reduce((total, row) => total + BigInt(row.amount_cents), 0n);
}

async function actor(db: DbClient, userId: string) {
  const user = await db.users.findOne({ select: { verified_email: true, timezone: true }, where: { id: userId } });
  if (!user) throw new HttpNotFoundError();
  return user;
}

function accessWhere(userId: string, email?: string) {
  return { OR: [
    { creditor_id: userId },
    { recipient_user_id: userId },
    ...(email ? [{ recipient_email_snapshot: email }] : []),
  ] };
}

function cursorDate(cursor?: string): { dueDate: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { dueDate?: unknown; id?: unknown };
    return typeof parsed.dueDate === "string" && typeof parsed.id === "string" ? { dueDate: parsed.dueDate, id: parsed.id } : undefined;
  } catch { return undefined; }
}

function visibleWhere(userId: string, email: string | undefined, filters: TimelineFilters, withCursor: boolean, today: string) {
  const access = filters.direction === "receivable" ? { creditor_id: userId }
    : filters.direction === "payable" ? { OR: [{ recipient_user_id: userId }, ...(email ? [{ recipient_email_snapshot: email }] : [])] }
      : accessWhere(userId, email);
  const cursor = withCursor ? cursorDate(filters.cursor) : undefined;
  return {
    AND: [access,
      ...(filters.status ? [{ state: filters.status === "overdue" ? "pending" as const : filters.status }] : []),
      ...(filters.status === "overdue" ? [{ due_date: { lt: today } }] : []),
      ...(filters.source ? [{ source: filters.source }] : []),
      ...(filters.from ? [{ due_date: { gte: filters.from } }] : []),
      ...(filters.to ? [{ due_date: { lte: filters.to } }] : []),
      ...(cursor ? [{ OR: [{ due_date: { gt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { gt: cursor.id } }] }] : []),
    ],
  };
}

function localDate(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function directionFor(row: ChargeRow, userId: string): Direction { return row.creditor_id === userId ? "receivable" : "payable"; }

export async function getTimeline(db: DbClient, userId: string, filters: TimelineFilters): Promise<TimelinePage> {
  const user = await actor(db, userId);
  const today = localDate(user.timezone);
  const allQuery = await db.charges.findMany({ select: CHARGE_SELECT, where: visibleWhere(userId, user.verified_email, filters, false, today) });
  const all = allQuery.records;
  const active = all.filter(row => row.state === "pending");
  const projected = filters.direction !== "payable" && filters.source !== "expense" && (!filters.status || filters.status === "pending")
    ? (await listRecurrences(db, userId)).flatMap(r => r.previews).filter(p => (!filters.from || p.occurrenceDate >= filters.from) && (!filters.to || p.occurrenceDate <= filters.to)) : [];
  const primary = [...all.map(row => ({ dueDate: row.due_date, id: row.id, row, preview: undefined })),
    ...projected.map(preview => ({ dueDate: preview.occurrenceDate, id: `recurrence:${preview.recurrenceId}:${preview.occurrenceDate}`, row: undefined, preview }))]
    .sort((a, b) => a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const cursor = cursorDate(filters.cursor);
  const remaining = primary.filter(item => !cursor || item.dueDate > cursor.dueDate || (item.dueDate === cursor.dueDate && item.id > cursor.id));
  const primaryPage = remaining.slice(0, 50);
  const page = primaryPage.flatMap(item => item.row ? [item.row] : []);
  const next = remaining.length > 50 ? primaryPage.at(-1) : undefined;
  // Group financial history with its charge page, preserving charge-cursor pagination.
  const history: TimelineItem[] = [];
  for (const row of page) {
    const direction = directionFor(row, userId);
    const proofs = await db.payment_proofs.findMany({ select: { id: true, state: true, created_at: true },
      where: { charge_id: row.id, ...(direction === "payable" ? { sender_user_id: userId } : {}) } });
    for (const proof of proofs.records) history.push({ kind: "proof", direction,
      proof: { id: proof.id, chargeId: row.id, state: proof.state, createdAt: proof.created_at } });
    const payments = await db.payments.findMany({ select: { id: true, amount_cents: true, paid_at: true }, where: { charge_id: row.id } });
    for (const payment of payments.records) history.push({ kind: "payment", direction,
      payment: { id: payment.id, chargeId: row.id, amount: money(payment.amount_cents), paidAt: payment.paid_at } });
  }
  const receivableIds = active.filter(row => row.creditor_id === userId).map(row => row.id);
  const proofsToReview = receivableIds.length ? await db.payment_proofs.count({ where: { charge_id: { isIn: receivableIds }, state: "pending" } }) : 0;
  return {
    items: [...primaryPage.map((item): TimelineItem => item.preview ? { kind: "recurrence_preview", direction: "receivable", preview: item.preview } : ({ kind: "charge", direction: directionFor(item.row!, userId), charge: {
      id: item.row!.id, description: item.row!.description, amount: money(item.row!.amount_cents), dueDate: item.row!.due_date, state: item.row!.state,
      source: item.row!.source, installment: item.row!.installment, installmentCount: item.row!.installment_count,
    } })), ...history],
    summary: {
      receivable: money(sum(active.filter(row => row.creditor_id === userId))),
      payable: money(sum(active.filter(row => row.creditor_id !== userId))),
      overdue: money(sum(active.filter(row => row.state === "pending" && row.due_date < today))),
      pending: money(sum(active.filter(row => row.state === "pending"))),
      proofsToReview,
    },
    nextCursor: next ? Buffer.from(JSON.stringify({ dueDate: next.dueDate, id: next.id })).toString("base64url") : null,
  };
}

export async function getPersonLedger(db: DbClient, userId: string, personId: string, cursor?: string): Promise<PersonLedger> {
  const person = await db.people.findOne({ select: { id: true, linked_user_id: true }, where: { id: personId, owner_id: userId } });
  if (!person) throw new HttpNotFoundError();
  const current = await actor(db, userId);
  const baseWhere = { OR: [
    { creditor_id: userId, debtor_person_id: personId },
    ...(person.linked_user_id ? [{ creditor_id: person.linked_user_id, OR: [
      { recipient_user_id: userId }, ...(current.verified_email ? [{ recipient_email_snapshot: current.verified_email }] : []),
    ] }] : []),
  ] };
  const pageWhere = { AND: [
    baseWhere,
    ...(cursor ? [{ id: { gt: cursor } }] : []),
  ] };
  const result = await db.charges.findMany({ select: CHARGE_SELECT, where: pageWhere, order: { id: Order.Asc }, take: 51 });
  const page = result.records.slice(0, 50);
  const all = await db.charges.findMany({ select: CHARGE_SELECT, where: baseWhere });
  const receivable = sum(all.records.filter(row => row.creditor_id === userId && row.state === "pending"));
  const payable = sum(all.records.filter(row => row.creditor_id !== userId && row.state === "pending"));
  return { personId, person: await getPerson(db, userId, personId), balance: money(receivable - payable), receivable: money(receivable), payable: money(payable),
    charges: await Promise.all(page.map(row => chargeDto(db, row, directionFor(row, userId)))),
    nextCursor: result.records.length > 50 ? page.at(-1)!.id : null };
}
