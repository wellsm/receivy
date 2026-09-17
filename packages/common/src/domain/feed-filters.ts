import { BillingRecurrence } from './billing';
import { addCalendarDays } from './billing-calendar';
import { chargeDirection, type ListCharge, type ListChargeItem } from './charge';
import { ChargeState, Direction } from './contracts';
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
  recurrence: BillingRecurrence[];
  period: FeedPeriod;
};

/** The feed opens on everything but the cancelled charges, which nobody has to act on. */
export const DEFAULT_FEED_FILTERS: FeedFilters = {
  direction: [],
  status: [FeedStatus.Pending, FeedStatus.Overdue, FeedStatus.Paid],
  recurrence: [],
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

export const FEED_TYPES: { value: BillingRecurrence; label: string }[] = [
  { value: BillingRecurrence.Once, label: 'À vista' },
  { value: BillingRecurrence.Until, label: 'Parcelado' },
  { value: BillingRecurrence.Indefinite, label: 'Recorrente' }
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
 * query type; the endpoint splits and validates them back. `month` (`YYYY-MM`) selects the Feed's
 * month; omitted, the API serves the current one.
 */
export function feedFilterQuery(filters: FeedFilters, today = calendarDate(), month?: string): URLSearchParams {
  const query = new URLSearchParams();

  if (filters.direction.length) {
    query.set('direction', filters.direction.join(','));
  }

  if (filters.status.length) {
    query.set('status', filters.status.join(','));
  }

  if (filters.recurrence.length) {
    query.set('recurrence', filters.recurrence.join(','));
  }

  const range = periodRange(filters.period, today);

  if (range) {
    query.set('from', range.from);
    query.set('to', range.to);
  }

  if (month) {
    query.set('month', month);
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
  return groupLabel(FEED_TYPES, filters.recurrence, 'Todas');
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

  if (!sameList(filters.recurrence, DEFAULT_FEED_FILTERS.recurrence)) {
    count++;
  }

  if (filters.period !== DEFAULT_FEED_FILTERS.period) {
    count++;
  }

  return count;
}

function readGroup<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]): T[] {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    return [];
  }

  return value.split(',').filter((entry): entry is T => allowed.includes(entry as T));
}

/**
 * The URL read back into filters: the inverse of `feedFilterQuery`, so the feed can live on the
 * address bar. Anything unknown is dropped, which leaves that group unrestricted.
 */
export function feedFiltersFromQuery(params: Record<string, string | string[] | undefined>, today = calendarDate()): FeedFilters {
  return {
    direction: readGroup(
      params.direction,
      FEED_DIRECTIONS.map(({ value }) => value)
    ),
    status: params.status === undefined ? DEFAULT_FEED_FILTERS.status : readGroup(params.status, FEED_STATUSES.map(({ value }) => value)),
    recurrence: readGroup(
      params.recurrence,
      FEED_TYPES.map(({ value }) => value)
    ),
    period: readPeriod(params, today)
  };
}

/** `feedFilterQuery` writes the period as the due-date range it stands for, so it is read back from there. */
function readPeriod(params: Record<string, string | string[] | undefined>, today: string): FeedPeriod {
  const single = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);
  const from = single(params.from);
  const to = single(params.to);

  if (from !== today) {
    return FeedPeriod.Any;
  }

  if (to === today) {
    return FeedPeriod.Today;
  }

  return to === addCalendarDays(today, 7) ? FeedPeriod.Week : FeedPeriod.Any;
}

function matchesStatus(charge: ListChargeItem, statuses: FeedStatus[], today: string): boolean {
  return statuses.some((status) => {
    if (status === FeedStatus.Overdue) {
      return charge.state === ChargeState.Pending && charge.due_date < today;
    }

    return charge.state === status;
  });
}

/**
 * The month narrowed down to what the filters ask for. The list endpoint answers with the whole
 * month, so every group is applied here; an empty group means no restriction on it.
 */
export function filterCharges(viewerEmail: string, charges: ListCharge, filters: FeedFilters, today = calendarDate()): ListCharge {
  const range = periodRange(filters.period, today);

  return charges.filter((charge) => {
    if (filters.direction.length && !filters.direction.includes(chargeDirection(charge, viewerEmail))) {
      return false;
    }

    if (filters.status.length && !matchesStatus(charge, filters.status, today)) {
      return false;
    }

    if (filters.recurrence.length && !filters.recurrence.includes(charge.billing.type as BillingRecurrence)) {
      return false;
    }

    return !range || (charge.due_date >= range.from && charge.due_date <= range.to);
  });
}
