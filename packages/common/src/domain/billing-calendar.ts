import {
  type BillingFrequency,
  type BillingInput,
  type BillingReminder,
  type BillingType,
  MAX_FINITE_OCCURRENCES,
  type NormalizedBillingInput
} from './billing';
import { resolveBillingSplit } from './split';

export type BillingCalendarRule = { frequency: BillingFrequency; startDate: string; endDate?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES: BillingType[] = ['once', 'until', 'indefinite'];
const FREQUENCIES: BillingFrequency[] = ['monthly', 'yearly'];

export function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);

  if (!ISO_DATE.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Data inválida.');
  }

  date.setUTCDate(date.getUTCDate() + days);

  const result = date.toISOString().slice(0, 10);

  if (!/^\d{4}-/.test(result)) {
    throw new RangeError('Data fora do intervalo permitido.');
  }

  return result;
}

export function materializationDate(dueDate: string, reminders: BillingReminder[]): string {
  const offsets = reminders.filter((reminder) => reminder.enabled).map((reminder) => reminder.offsetDays);

  return addCalendarDays(dueDate, offsets.length ? Math.min(...offsets) : 0);
}

/** Civil due dates of a rule between `from` and `to` (inclusive). Day and month come from `startDate`. */
export function billingDates(rule: BillingCalendarRule, from: string, to: string, limit = 100): string[] {
  const start = from > rule.startDate ? from : rule.startDate;
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const day = Number(rule.startDate.slice(8, 10));
  const dates: string[] = [];

  let year = Number(start.slice(0, 4));
  let month = rule.frequency === 'yearly' ? Number(rule.startDate.slice(5, 7)) : Number(start.slice(5, 7));

  while (year <= Number(end.slice(0, 4)) && dates.length < limit) {
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const due = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;

    if (due > end) {
      break;
    }

    if (due >= start) {
      dates.push(due);
    }

    if (rule.frequency === 'yearly') {
      year++;
      continue;
    }

    month++;

    if (month === 13) {
      month = 1;
      year++;
    }
  }

  return dates;
}

/** Every due date of a finite billing. Throws for `indefinite`, which is materialized by the job. */
export function billingDueDates(input: Pick<BillingInput, 'type' | 'frequency' | 'startDate' | 'endDate'>): string[] {
  if (input.type === 'once') {
    return [input.startDate];
  }

  if (input.type === 'indefinite') {
    throw new RangeError('Cobranças sem fim são geradas pelo job, não na criação.');
  }

  if (!input.frequency || !input.endDate) {
    throw new RangeError('Informe a frequência e a data final.');
  }

  const dates = billingDates(
    { frequency: input.frequency, startDate: input.startDate, endDate: input.endDate },
    input.startDate,
    input.endDate,
    MAX_FINITE_OCCURRENCES + 1
  );

  if (dates.length > MAX_FINITE_OCCURRENCES) {
    throw new RangeError(`Uma cobrança até uma data aceita no máximo ${MAX_FINITE_OCCURRENCES} ocorrências.`);
  }

  return dates;
}

function validateReminders(reminders: BillingReminder[]): BillingReminder[] {
  const invalid = reminders.some(
    (reminder) => !Number.isInteger(reminder.offsetDays) || Math.abs(reminder.offsetDays) > 90 || typeof reminder.enabled !== 'boolean'
  );
  const unique = new Set(reminders.map((reminder) => reminder.offsetDays)).size === reminders.length;

  if (reminders.length > 10 || invalid || !unique) {
    throw new RangeError('Lembretes inválidos: use dias únicos entre -90 e 90.');
  }

  return [...reminders]
    .map((reminder) => ({ offsetDays: reminder.offsetDays, enabled: reminder.enabled }))
    .sort((a, b) => a.offsetDays - b.offsetDays);
}

export function normalizeBillingInput(input: BillingInput): NormalizedBillingInput {
  if (!TYPES.includes(input.type)) {
    throw new RangeError('Tipo de cobrança inválido.');
  }

  if (!input.timezone) {
    throw new RangeError('Informe o fuso horário.');
  }

  // Throws RangeError for unknown IANA names.
  new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(new Date(0));

  addCalendarDays(input.startDate, 0);

  if (input.endDate) {
    addCalendarDays(input.endDate, 0);
  }

  const recurring = input.type !== 'once';

  if (recurring && (!input.frequency || !FREQUENCIES.includes(input.frequency))) {
    throw new RangeError('Informe a frequência: mensal ou anual.');
  }

  if (input.type === 'until' && !input.endDate) {
    throw new RangeError('Informe a data final.');
  }

  if (input.type === 'indefinite' && input.endDate) {
    throw new RangeError('Cobranças sem fim não aceitam data final.');
  }

  if (input.endDate && input.endDate < input.startDate) {
    throw new RangeError('Fim anterior ao início.');
  }

  const description = input.description?.normalize('NFC').trim() || 'Cobrança';

  if (description.length > 500) {
    throw new RangeError('Informe uma descrição de até 500 caracteres.');
  }

  resolveBillingSplit(input.totalCents, input.split);

  if (input.type === 'until') {
    billingDueDates(input);
  }

  return {
    type: input.type,
    frequency: recurring ? input.frequency : undefined,
    description,
    totalCents: input.totalCents,
    startDate: input.startDate,
    endDate: input.type === 'until' ? input.endDate : undefined,
    timezone: input.timezone,
    paymentMethodId: input.paymentMethodId || undefined,
    reminders: input.reminders ? validateReminders(input.reminders) : undefined,
    split: input.split
  };
}
