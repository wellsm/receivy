import { describe, expect, it } from 'vitest';
import { BillingType } from './billing';
import { Direction } from './contracts';
import {
  activeFeedFilterCount,
  DEFAULT_FEED_FILTERS,
  type FeedFilters,
  FeedPeriod,
  FeedStatus,
  feedDirectionLabel,
  feedFilterQuery,
  feedStatusLabel,
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
      type: [BillingType.Once],
      period: FeedPeriod.Any
    };

    expect(feedFilterQuery(filters, '2026-09-11').toString()).toBe('direction=receivable%2Cpayable&status=paid%2Ccancelled&type=once');
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
