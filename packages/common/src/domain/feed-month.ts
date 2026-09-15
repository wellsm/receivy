import { calendarDate } from './financial-form';

const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export type MonthTab = { value: string; label: string; selected: boolean };

function assertMonth(month: string): void {
  if (!MONTH_FORMAT.test(month)) {
    throw new RangeError('Mês inválido: use o formato AAAA-MM.');
  }
}

/** The feed's default month: `today` read in `timezone` (or the local one), as `YYYY-MM`. */
export function currentMonth(today: Date, timezone?: string): string {
  return calendarDate(today, timezone).slice(0, 7);
}

/** `month` shifted by `delta` months, carrying the year over on either boundary. */
export function shiftMonth(month: string, delta: number): string {
  assertMonth(month);

  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = ((index % 12) + 12) % 12;

  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth + 1).padStart(2, '0')}`;
}

/** pt-BR 3-letter month + 2-digit year, e.g. `ago/26`. */
export function monthLabel(month: string): string {
  assertMonth(month);

  const index = Number(month.slice(5, 7)) - 1;

  return `${SHORT_MONTHS[index]}/${month.slice(2, 4)}`;
}

/** Previous, selected and next month, for the Feed's month tabs. */
export function monthTabs(selected: string): MonthTab[] {
  assertMonth(selected);

  return [-1, 0, 1].map((delta) => {
    const value = shiftMonth(selected, delta);

    return { value, label: monthLabel(value), selected: delta === 0 };
  });
}
