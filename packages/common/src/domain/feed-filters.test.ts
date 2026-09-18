import { describe, expect, it } from 'vitest';
import { BillingKind, BillingRecurrence } from './billing';
import type { ListChargeItem } from './charge';
import { ChargeState, Direction } from './contracts';
import {
  activeFeedFilterCount,
  DEFAULT_FEED_FILTERS,
  type FeedFilters,
  FeedPeriod,
  FeedStatus,
  feedDirectionLabel,
  feedFilterQuery,
  feedFiltersFromQuery,
  feedStatusLabel,
  filterCharges,
  toggleFeedValue
} from './feed-filters';

const base: FeedFilters = DEFAULT_FEED_FILTERS;

describe('feed filters', () => {
  it('opens on every status but cancelled', () => {
    expect(DEFAULT_FEED_FILTERS.status).toEqual(['pending', 'overdue', 'paid']);
    expect(feedFilterQuery(base, '2026-09-11').toString()).toBe('status=pending%2Coverdue%2Cpaid');
  });

  it('joins every selected value of a group into one comma-separated parameter', () => {
    const filters: FeedFilters = {
      direction: [Direction.Receivable, Direction.Payable],
      status: [FeedStatus.Paid, FeedStatus.Cancelled],
      recurrence: [BillingRecurrence.Once],
      period: FeedPeriod.Any
    };

    expect(feedFilterQuery(filters, '2026-09-11').toString()).toBe('direction=receivable%2Cpayable&status=paid%2Ccancelled&recurrence=once');
  });

  it('turns the period into a due-date range', () => {
    expect(feedFilterQuery({ ...base, status: [], period: FeedPeriod.Today }, '2026-09-11').toString()).toBe(
      'from=2026-09-11&to=2026-09-11'
    );
    expect(feedFilterQuery({ ...base, status: [], period: FeedPeriod.Week }, '2026-09-11').toString()).toBe(
      'from=2026-09-11&to=2026-09-18'
    );
  });

  it('serializes an optional month alongside the other filters', () => {
    expect(feedFilterQuery(base, '2026-09-11', '2026-08').toString()).toBe('status=pending%2Coverdue%2Cpaid&month=2026-08');
    expect(feedFilterQuery(base, '2026-09-11').toString()).toBe('status=pending%2Coverdue%2Cpaid');
  });

  it('toggles a value in and out of its group', () => {
    expect(toggleFeedValue(['receivable'], 'payable')).toEqual(['receivable', 'payable']);
    expect(toggleFeedValue(['receivable', 'payable'], 'receivable')).toEqual(['payable']);
  });

  it('reads an empty or complete group as "all"', () => {
    expect(feedDirectionLabel({ ...base, direction: [] })).toBe('Todas');
    expect(feedDirectionLabel({ ...base, direction: [Direction.Receivable, Direction.Payable] })).toBe('Todas');
    expect(feedDirectionLabel({ ...base, direction: [Direction.Payable] })).toBe('A pagar');
    expect(feedStatusLabel({ ...base, status: [FeedStatus.Pending, FeedStatus.Overdue] })).toBe('Pendentes, Atrasadas');
  });

  it('counts only the groups that differ from the default', () => {
    expect(activeFeedFilterCount(base)).toBe(0);
    expect(activeFeedFilterCount({ ...base, status: [] })).toBe(1);
    expect(activeFeedFilterCount({ ...base, direction: [Direction.Payable], period: FeedPeriod.Today })).toBe(2);
  });
});

describe('feed filters over a month of charges', () => {
  const today = '2026-09-11';
  const charge = (overrides: Partial<ListChargeItem> = {}): ListChargeItem => ({
    id: crypto.randomUUID(),
    billingId: 'b1',
    description: 'Aluguel',
    state: ChargeState.Pending,
    dueDate: today,
    amountCents: 1000,
    type: Direction.Receivable,
    ownedByViewer: true,
    hasPayment: false,
    notify: true,
    counterpartReachable: true,
    confirmationRequired: true,
    proof: null,
    billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, contact: null },
    debtor: { name: 'Bruno' },
    ...overrides
  });

  it('reads back what feedFilterQuery wrote', () => {
    const filters: FeedFilters = {
      direction: [Direction.Payable],
      status: [FeedStatus.Paid],
      recurrence: [BillingRecurrence.Until],
      period: FeedPeriod.Week
    };

    expect(feedFiltersFromQuery(Object.fromEntries(feedFilterQuery(filters, today)), today)).toEqual(filters);
  });

  it('falls back to the open feed when the URL says nothing or says nonsense', () => {
    expect(feedFiltersFromQuery({})).toEqual(DEFAULT_FEED_FILTERS);
    expect(feedFiltersFromQuery({ status: 'burned', period: 'yesterday' })).toEqual({ ...DEFAULT_FEED_FILTERS, status: [] });
  });

  it('keeps only the side, state, type and period the filters ask for', () => {
    const charges = [
      charge({ id: 'open-in' }),
      charge({ id: 'paid-in', state: ChargeState.Paid }),
      charge({ id: 'open-out', type: Direction.Payable }),
      charge({ id: 'until-in', billing: { recurrence: BillingRecurrence.Until, kind: BillingKind.Live, contact: null } }),
      charge({ id: 'late-in', dueDate: '2026-09-01' })
    ];
    const ids = (filters: Partial<FeedFilters>) =>
      filterCharges(charges, { ...DEFAULT_FEED_FILTERS, ...filters }, today).map((item) => item.id);

    expect(ids({ direction: [Direction.Payable] })).toEqual(['open-out']);
    expect(ids({ status: [FeedStatus.Paid] })).toEqual(['paid-in']);
    expect(ids({ status: [FeedStatus.Overdue] })).toEqual(['late-in']);
    expect(ids({ recurrence: [BillingRecurrence.Until] })).toEqual(['until-in']);
    expect(ids({ period: FeedPeriod.Today })).toEqual(['open-in', 'paid-in', 'open-out', 'until-in']);
  });

  it('leaves the month untouched when every group is open', () => {
    const charges = [charge(), charge({ state: ChargeState.Cancelled })];

    expect(filterCharges(charges, { ...DEFAULT_FEED_FILTERS, status: [] }, today)).toHaveLength(2);
  });
});
