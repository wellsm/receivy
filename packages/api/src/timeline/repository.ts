import { Order } from "@ez4/database";
import type { ChargeState, Direction, PersonLedger, TimelinePage } from "@receivy/common";
import type { DbClient } from "../database";
import { CHARGE_SELECT, chargeDto, type ChargeRow } from "../charges/repository";
import { HttpNotFoundError } from "@ez4/gateway";

export type TimelineFilters = {
  cursor?: string;
  direction?: Direction;
  status?: ChargeState | "overdue";
  source?: "expense" | "recurrence";
  from?: string;
  to?: string;
};

function money(amountCents: number) { return { amountCents, currency: "BRL" as const }; }

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
  const pageQuery = await db.charges.findMany({ select: CHARGE_SELECT, where: visibleWhere(userId, user.verified_email, filters, true, today),
    order: { due_date: Order.Asc, id: Order.Asc }, take: 51 });
  const page = pageQuery.records.slice(0, 50);
  const allQuery = await db.charges.findMany({ select: CHARGE_SELECT, where: visibleWhere(userId, user.verified_email, filters, false, today) });
  const all = allQuery.records;
  const active = all.filter(row => row.state === "pending");
  const sum = (rows: ChargeRow[]) => rows.reduce((total, row) => total + row.amount_cents, 0);
  const next = pageQuery.records.length > 50 ? page.at(-1) : undefined;
  return {
    items: page.map(row => ({ kind: "charge", direction: directionFor(row, userId), charge: {
      id: row.id, description: row.description, amount: money(row.amount_cents), dueDate: row.due_date, state: row.state,
      source: row.source, installment: row.installment, installmentCount: row.installment_count,
    } })),
    summary: {
      receivable: money(sum(active.filter(row => row.creditor_id === userId))),
      payable: money(sum(active.filter(row => row.creditor_id !== userId))),
      overdue: money(sum(active.filter(row => row.state === "pending" && row.due_date < today))),
      pending: money(sum(active.filter(row => row.state === "pending"))),
      proofsToReview: 0,
    },
    nextCursor: next ? Buffer.from(JSON.stringify({ dueDate: next.due_date, id: next.id })).toString("base64url") : null,
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
  const receivable = all.records.filter(row => row.creditor_id === userId && row.state === "pending").reduce((sum, row) => sum + row.amount_cents, 0);
  const payable = all.records.filter(row => row.creditor_id !== userId && row.state === "pending").reduce((sum, row) => sum + row.amount_cents, 0);
  return { personId, balance: money(receivable - payable), receivable: money(receivable), payable: money(payable),
    charges: await Promise.all(page.map(row => chargeDto(db, row, directionFor(row, userId)))),
    nextCursor: result.records.length > 50 ? page.at(-1)!.id : null };
}
