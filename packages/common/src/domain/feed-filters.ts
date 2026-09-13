import { BillingType } from './billing';
import { addCalendarDays } from './billing-calendar';
import { Direction } from './contracts';
import { calendarDate } from './financial-form';

/** `overdue` is not a stored state: it is a pending charge whose due date already passed. */
export const enum FeedStatus {
  Pending = 'pending',
  Overdue = 'overdue',
  Paid = 'paid',
  Cancelled = 'cancelled'
}

export const enum FeedPeriod {
  Any = 'any',
  Today = 'today',
  Week = 'week'
}

/** Every list is an "any of"; an empty one means no restriction on that group. */
export type FeedFilters = {
  direction: Direction[];
  status: FeedStatus[];
  type: BillingType[];
  period: FeedPeriod;
};

/** The feed opens on everything but the cancelled charges, which nobody has to act on. */
export const DEFAULT_FEED_FILTERS: FeedFilters = {
  direction: [],
  status: [FeedStatus.Pending, FeedStatus.Overdue, FeedStatus.Paid],
  type: [],
  period: FeedPeriod.Any
};

export const FEED_DIRECTIONS: { value: Direction; label: string }[] = [
  { value: Direction.Receivable, label: 'A receber' },
  { value: Direction.Payable, label: 'A pagar' }
];

export const FEED_STATUSES: { value: FeedStatus; label: string }[] = [
  { value: FeedStatus.Pending, label: 'Pendentes' },
  { value: FeedStatus.Overdue, label: 'Atrasadas' },
  { value: FeedStatus.Paid, label: 'Pagas' },
  { value: FeedStatus.Cancelled, label: 'Canceladas' }
];

export const FEED_TYPES: { value: BillingType; label: string }[] = [
  { value: BillingType.Once, label: 'À vista' },
  { value: BillingType.Until, label: 'Parcelado' },
  { value: BillingType.Indefinite, label: 'Recorrente' }
];

export const FEED_PERIODS: { value: FeedPeriod; label: string }[] = [
  { value: FeedPeriod.Any, label: 'Qualquer data' },
  { value: FeedPeriod.Today, label: 'Hoje' },
  { value: FeedPeriod.Week, label: 'Esta semana' }
];

/** Paid and cancelled close a charge; everything else is still open. */
export const CLOSED_FEED_STATUSES: FeedStatus[] = [FeedStatus.Paid, FeedStatus.Cancelled];

export function toggleFeedValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function periodRange(period: FeedPeriod, today: string): { from: string; to: string } | null {
  if (period === FeedPeriod.Today) {
    return { from: today, to: today };
  }

  if (period === FeedPeriod.Week) {
    return { from: today, to: addCalendarDays(today, 7) };
  }

  return null;
}

/**
 * The timeline query string. Lists travel comma-separated because the gateway has no array
 * query type; the endpoint splits and validates them back.
 */
export function feedFilterQuery(filters: FeedFilters, today = calendarDate()): URLSearchParams {
  const query = new URLSearchParams();

  if (filters.direction.length) {
    query.set('direction', filters.direction.join(','));
  }

  if (filters.status.length) {
    query.set('status', filters.status.join(','));
  }

  if (filters.type.length) {
    query.set('type', filters.type.join(','));
  }

  const range = periodRange(filters.period, today);

  if (range) {
    query.set('from', range.from);
    query.set('to', range.to);
  }

  return query;
}

function groupLabel<T>(options: { value: T; label: string }[], selected: T[], every: string): string {
  if (!selected.length || selected.length === options.length) {
    return every;
  }

  return options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label)
    .join(', ');
}

export function feedDirectionLabel(filters: FeedFilters): string {
  return groupLabel(FEED_DIRECTIONS, filters.direction, 'Todas');
}

export function feedStatusLabel(filters: FeedFilters): string {
  return groupLabel(FEED_STATUSES, filters.status, 'Todos');
}

export function feedTypeLabel(filters: FeedFilters): string {
  return groupLabel(FEED_TYPES, filters.type, 'Todas');
}

export function feedPeriodLabel(filters: FeedFilters): string {
  return FEED_PERIODS.find((option) => option.value === filters.period)?.label ?? 'Qualquer data';
}

function sameList<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

/** How many groups differ from the default, for the badge on the mobile filters button. */
export function activeFeedFilterCount(filters: FeedFilters): number {
  let count = 0;

  if (!sameList(filters.direction, DEFAULT_FEED_FILTERS.direction)) {
    count++;
  }

  if (!sameList(filters.status, DEFAULT_FEED_FILTERS.status)) {
    count++;
  }

  if (!sameList(filters.type, DEFAULT_FEED_FILTERS.type)) {
    count++;
  }

  if (filters.period !== DEFAULT_FEED_FILTERS.period) {
    count++;
  }

  return count;
}
