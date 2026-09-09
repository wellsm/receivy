import { describe, expect, it } from 'vitest';
import { dayDiff, lastBilledHint, shortDayMonth } from './calendar-labels';

describe('dayDiff', () => {
  it('counts forward days as positive', () => {
    expect(dayDiff('2026-09-10', '2026-09-13')).toBe(3);
  });

  it('counts backward days as negative', () => {
    expect(dayDiff('2026-09-13', '2026-09-10')).toBe(-3);
  });

  it('returns zero for the same day and crosses month and year borders', () => {
    expect(dayDiff('2026-09-10', '2026-09-10')).toBe(0);
    expect(dayDiff('2026-09-30', '2026-10-01')).toBe(1);
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('lastBilledHint', () => {
  it('reports contacts that were never billed', () => {
    expect(lastBilledHint(null, '2026-09-10')).toBe('Sem cobranças');
  });

  it('names today and yesterday', () => {
    expect(lastBilledHint('2026-09-10T12:00:00.000Z', '2026-09-10')).toBe('Hoje');
    expect(lastBilledHint('2026-09-09T12:00:00.000Z', '2026-09-10')).toBe('Ontem');
  });

  it('counts days, then weeks, then months', () => {
    expect(lastBilledHint('2026-09-04T12:00:00.000Z', '2026-09-10')).toBe('6d');
    expect(lastBilledHint('2026-09-03T12:00:00.000Z', '2026-09-10')).toBe('1sem');
    expect(lastBilledHint('2026-08-11T12:00:00.000Z', '2026-09-10')).toBe('1m');
  });

  it('treats a future date as today', () => {
    expect(lastBilledHint('2026-09-12T12:00:00.000Z', '2026-09-10')).toBe('Hoje');
  });
});

describe('shortDayMonth', () => {
  it('formats a calendar date as dd/mm', () => {
    expect(shortDayMonth('2026-09-07')).toBe('07/09');
  });

  it('reads an instant in UTC so late-night dates keep their day', () => {
    expect(shortDayMonth('2026-09-07T23:30:00.000Z')).toBe('07/09');
  });
});
