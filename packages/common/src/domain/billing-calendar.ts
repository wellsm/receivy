import {
  BillingDueRule,
  BillingFrequency,
  type BillingInput,
  type BillingPixInput,
  type BillingReminder,
  BillingType,
  MAX_FINITE_OCCURRENCES,
  type NormalizedBillingInput,
  SplitPartKind
} from './billing';
import { Direction, SplitMode } from './contracts';
import { calendarDate } from './financial-form';
import { normalizePixKey } from './pix-key';
import { type BillingSplit, resolveBillingSplit } from './split';

export type BillingCalendarRule = { frequency: BillingFrequency; startDate: string; endDate?: string; dueRule?: BillingDueRule };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_YEAR_MONTH = /^\d{4}-\d{2}$/;
const TYPES: BillingType[] = [BillingType.Once, BillingType.Until, BillingType.Indefinite];
const FREQUENCIES: BillingFrequency[] = [BillingFrequency.Monthly, BillingFrequency.Yearly];

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

export function startOfMonth(value: string): string {
  const month = Number(value.slice(5, 7));

  if (!ISO_DATE.test(value) && !ISO_YEAR_MONTH.test(value)) {
    throw new RangeError('Invalid date.');
  }

  if (month < 1 || month > 12) {
    throw new RangeError('Invalid month.');
  }

  return `${value.slice(0, 7)}-01`;
}

/** Last day of the month `value` falls in; only its year and month are read. */
export function endOfMonth(value: string): string {
  const month = Number(value.slice(5, 7));

  if (!ISO_DATE.test(value) && !ISO_YEAR_MONTH.test(value)) {
    throw new RangeError('Invalid date.');
  }

  if (month < 1 || month > 12) {
    throw new RangeError('Invalid month.');
  }

  const day = new Date(Date.UTC(Number(value.slice(0, 4)), month, 0)).getUTCDate();

  return `${value.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

function earliestOffset(reminders: BillingReminder[]): number {
  const offsets = reminders.filter((reminder) => reminder.enabled).map((reminder) => reminder.offsetDays);

  return offsets.length ? Math.min(...offsets) : 0;
}

/** The day an occurrence becomes a charge: the first day of its month, or earlier when a reminder fires before that. */
export function materializationDate(dueDate: string, reminders: BillingReminder[]): string {
  const byReminder = addCalendarDays(dueDate, earliestOffset(reminders));
  const monthStart = `${dueDate.slice(0, 7)}-01`;

  return byReminder < monthStart ? byReminder : monthStart;
}

/** The last due date that must already exist today: the month end, or later when an early reminder reaches next month. */
export function materializationHorizon(today: string, reminders: BillingReminder[]): string {
  const byReminder = addCalendarDays(today, -earliestOffset(reminders));
  const monthEnd = endOfMonth(today);

  return byReminder > monthEnd ? byReminder : monthEnd;
}

/** Civil due dates of a rule between `from` and `to` (inclusive). Day and month come from `startDate`, or the month end. */
export function billingDates(rule: BillingCalendarRule, from: string, to: string, limit = 100): string[] {
  const start = from > rule.startDate ? from : rule.startDate;
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  // Day 31 clamps to every month's last day, so a month-end rule never inherits a shorter start day.
  const day = rule.dueRule === BillingDueRule.EndOfMonth ? 31 : Number(rule.startDate.slice(8, 10));
  const dates: string[] = [];

  let year = Number(start.slice(0, 4));
  let month = rule.frequency === BillingFrequency.Yearly ? Number(rule.startDate.slice(5, 7)) : Number(start.slice(5, 7));

  while (year <= Number(end.slice(0, 4)) && dates.length < limit) {
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const due = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;

    if (due > end) {
      break;
    }

    if (due >= start) {
      dates.push(due);
    }

    if (rule.frequency === BillingFrequency.Yearly) {
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
export function billingDueDates(input: Pick<BillingInput, 'type' | 'frequency' | 'startDate' | 'endDate' | 'dueRule'>): string[] {
  if (input.type === BillingType.Once) {
    return [input.startDate];
  }

  if (input.type === BillingType.Indefinite) {
    throw new RangeError('Cobranças sem fim são geradas pelo job, não na criação.');
  }

  if (!input.frequency || !input.endDate) {
    throw new RangeError('Informe a frequência e a data final.');
  }

  const dates = billingDates(
    { frequency: input.frequency, startDate: input.startDate, endDate: input.endDate, dueRule: input.dueRule },
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

/** The free-text counterpart of a registro: 1 to 120 characters once trimmed. */
export function normalizeCounterpartLabel(label: string | undefined, direction: Direction): string {
  const value = label?.normalize('NFC').trim() ?? '';

  if (value.length >= 1 && value.length <= 120) {
    return value;
  }

  if (direction === Direction.Payable) {
    throw new RangeError('Informe para quem é o valor.');
  }

  throw new RangeError('Informe de quem é o valor.');
}

/** `now` turns on the rule only a creation obeys: a recorrente registro starts today or later. */
export function normalizeBillingInput(input: BillingInput, now?: Date): NormalizedBillingInput {
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

  const recurring = input.type !== BillingType.Once;

  if (recurring && (!input.frequency || !FREQUENCIES.includes(input.frequency))) {
    throw new RangeError('Informe a frequência: mensal ou anual.');
  }

  const monthEnd = input.dueRule === BillingDueRule.EndOfMonth;

  if (monthEnd && recurring && input.frequency !== BillingFrequency.Monthly) {
    throw new RangeError('Final do mês só vale para cobranças mensais.');
  }

  if (monthEnd && input.startDate !== endOfMonth(input.startDate)) {
    throw new RangeError('Com final do mês, o vencimento deve ser o último dia do mês.');
  }

  if (input.type === BillingType.Until && !input.endDate) {
    throw new RangeError('Informe a data final.');
  }

  if (input.type === BillingType.Indefinite && input.endDate) {
    throw new RangeError('Cobranças sem fim não aceitam data final.');
  }

  if (input.endDate && input.endDate < input.startDate) {
    throw new RangeError('Fim anterior ao início.');
  }

  const description = input.description?.normalize('NFC').trim() || 'Conta';

  if (description.length > 500) {
    throw new RangeError('Informe uma descrição de até 500 caracteres.');
  }

  const direction = input.direction ?? Direction.Receivable;

  if (direction !== Direction.Receivable && direction !== Direction.Payable) {
    throw new RangeError('Direção inválida.');
  }

  const settled = input.settled === true;
  // Checked before the split, so a registro reads its own message instead of the direction's.
  const counterpartLabel = settled ? registroLabel(input, direction, now) : undefined;
  const split = splitOf(input, direction, settled);

  resolveBillingSplit(input.totalCents, split);

  if (input.type === BillingType.Until) {
    billingDueDates(input);
  }

  return {
    type: input.type,
    frequency: recurring ? input.frequency : undefined,
    description,
    totalCents: input.totalCents,
    startDate: input.startDate,
    endDate: input.type === BillingType.Until ? input.endDate : undefined,
    // Only the month end is carried: 'fixed' stays implicit, like before the rule existed.
    dueRule: monthEnd ? BillingDueRule.EndOfMonth : undefined,
    timezone: input.timezone,
    paymentMethodId: direction === Direction.Receivable ? input.paymentMethodId || undefined : undefined,
    reminders: input.reminders ? validateReminders(input.reminders) : undefined,
    split,
    category: input.category,
    direction,
    payeeUserId: direction === Direction.Payable ? input.payeeUserId?.trim() || undefined : undefined,
    pix: direction === Direction.Payable && input.pix ? normalizeBillingPix(input.pix) : undefined,
    settled: settled ? true : undefined,
    counterpartLabel
  };
}

/** A conta a receber always names who pays: at least one contact beside the owner. */
function receivableSplit(input: BillingInput): BillingSplit {
  const split = input.split;

  if (!split || !split.parts.some((part) => part.kind === SplitPartKind.User)) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  return split;
}

/** The allocation behind a billing: the owner alone on a registro or a conta a pagar, the contacts on a conta a receber. */
function splitOf(input: BillingInput, direction: Direction, settled: boolean): BillingSplit {
  if (settled) {
    return { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] };
  }

  if (direction === Direction.Payable) {
    return payableSplit(input);
  }

  return receivableSplit(input);
}

/**
 * A registro is the owner's alone: it names the counterpart in free text and refuses anyone to split with, pay
 * through or remind. With a clock (creation), a recorrente registro may not start before today.
 */
function registroLabel(input: BillingInput, direction: Direction, now: Date | undefined): string {
  const label = normalizeCounterpartLabel(input.counterpartLabel, direction);
  const participants = input.split?.parts.some((part) => part.kind === SplitPartKind.User) === true;

  if (participants || input.payeeUserId || input.paymentMethodId || input.pix || input.reminders) {
    throw new RangeError('Registro não tem participantes nem avisos.');
  }

  if (now && input.type !== BillingType.Once && input.startDate < calendarDate(now, input.timezone)) {
    throw new RangeError('Registro recorrente começa hoje ou depois.');
  }

  return label;
}

/** A conta a pagar has a single payer, the owner: the allocation is the owner alone and no wallet key applies. */
function payableSplit(input: BillingInput): BillingSplit {
  if (input.split && input.split.parts.some((part) => part.kind === SplitPartKind.User)) {
    throw new RangeError('Uma conta a pagar não divide o valor com contatos.');
  }

  if (input.paymentMethodId) {
    throw new RangeError('Uma conta a pagar usa a chave Pix de quem recebe, não a sua.');
  }

  return { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] };
}

function normalizeBillingPix(pix: BillingPixInput): BillingPixInput {
  const label = pix.label?.normalize('NFC').trim() || undefined;

  if (label && label.length > 120) {
    throw new RangeError('Rótulo inválido.');
  }

  return { keyType: pix.keyType, key: normalizePixKey(pix.keyType, pix.key), label };
}

const CLOCK_PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
};

function zoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...CLOCK_PARTS }).formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));

  return asUtc - utcMs;
}

/** UTC instant of `localDate` at `time` (HH:mm) in `timezone`. Brazil has no DST, so one offset lookup is exact. */
export function zonedInstant(localDate: string, time: string, timezone: string): string {
  const guess = Date.parse(`${localDate}T${time}:00Z`);

  return new Date(guess - zoneOffsetMs(guess, timezone)).toISOString();
}

export function civilHour(now: number, timezone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit' }).format(now));
}
