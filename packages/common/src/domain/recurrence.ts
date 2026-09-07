import type { RecurrenceInput, RecurrenceReminder } from "./contracts";
import { planExpenseCharges } from "./charge-plan";

type CalendarRule = { frequency: "monthly" | "yearly"; day: number; month?: number; startDate: string; endDate?: string };

export function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError("Data inválida.");
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  if (!/^\d{4}-/.test(result)) throw new RangeError("Data fora do intervalo permitido.");
  return result;
}

export function materializationDate(dueDate: string, reminders: RecurrenceReminder[]): string {
  const offsets = reminders.filter(r => r.enabled).map(r => r.offsetDays);
  return addCalendarDays(dueDate, offsets.length ? Math.min(...offsets) : 0);
}

export function recurrenceDates(rule: CalendarRule, from: string, to: string, limit = 100): string[] {
  const start = from > rule.startDate ? from : rule.startDate;
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const dates: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = rule.frequency === "yearly" ? rule.month! : Number(start.slice(5, 7));
  while (year <= Number(end.slice(0, 4)) && dates.length < limit) {
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const due = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(rule.day, maxDay)).padStart(2, "0")}`;
    if (due > end) break;
    if (due >= start) dates.push(due);
    if (rule.frequency === "yearly") year++;
    else { month++; if (month === 13) { month = 1; year++; } }
  }
  return dates;
}

export function normalizeRecurrenceInput(input: RecurrenceInput) {
  new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(new Date(0));
  if (!input.timezone || !Number.isInteger(input.day) || input.day < 1 || input.day > 31 || !["monthly", "yearly"].includes(input.frequency)) throw new RangeError("Frequência ou dia inválido.");
  if (input.frequency === "yearly" && (!Number.isInteger(input.month) || input.month! < 1 || input.month! > 12)) throw new RangeError("Mês inválido.");
  if (input.startDate) addCalendarDays(input.startDate, 0);
  if (input.endDate) addCalendarDays(input.endDate, 0);
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new RangeError("Fim anterior ao início.");
  const description = input.description?.normalize("NFC").trim() || "Recorrência";
  planExpenseCharges({ ...input, description, installmentCount: 1, firstDueDate: input.startDate ?? "2026-01-01" });
  const reminders = input.reminders ?? [-3, 0, 2].map(offsetDays => ({ offsetDays, channel: "auto" as const, enabled: true }));
  if (reminders.length > 10 || reminders.some(r => !Number.isInteger(r.offsetDays) || Math.abs(r.offsetDays) > 90 || r.channel !== "auto" || typeof r.enabled !== "boolean") || new Set(reminders.map(r => r.offsetDays)).size !== reminders.length) throw new RangeError("Lembretes inválidos: use dias únicos entre -90 e 90.");
  return { ...input, description, reminders: [...reminders].sort((a, b) => a.offsetDays - b.offsetDays), ...(input.frequency === "monthly" ? { month: undefined } : {}) };
}
