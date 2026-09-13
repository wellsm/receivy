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
import { normalizePixKey } from './pix-key';
import { type BillingSplit, resolveBillingSplit } from './split';

export type BillingCalendarRule = { frequency: BillingFrequency; startDate: string; endDate?: string; dueRule?: BillingDueRule };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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

/** Last day of the month `value` falls in; only its year and month are read. */
export function endOfMonth(value: string): string {
  const month = Number(value.slice(5, 7));

  if (!ISO_DATE.test(value) || month < 1 || month > 12) {
    throw new RangeError('Data inválida.');
  }

  const day = new Date(Date.UTC(Number(value.slice(0, 4)), month, 0)).getUTCDate();

  return `${value.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

export function materializationDate(dueDate: string, reminders: BillingReminder[]): string {
  const offsets = reminders.filter((reminder) => reminder.enabled).map((reminder) => reminder.offsetDays);

  return addCalendarDays(dueDate, offsets.length ? Math.min(...offsets) : 0);
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

  const split = direction === Direction.Payable ? payableSplit(input) : receivableSplit(input);

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
    pix: direction === Direction.Payable && input.pix ? normalizeBillingPix(input.pix) : undefined
  };
}

/** A conta a receber always names who pays. */
function receivableSplit(input: BillingInput): BillingSplit {
  if (!input.split) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  return input.split;
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
