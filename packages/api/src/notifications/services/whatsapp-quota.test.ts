import { describe, expect, it } from 'vitest';
import { cycleOf } from './whatsapp-quota';

describe('cycleOf', () => {
  it('runs one month back from the subscription period end', () => {
    expect(cycleOf('2026-10-15T03:00:00.000Z', new Date('2026-09-25T12:00:00Z'))).toEqual({ from: '2026-09-15T03:00:00.000Z', to: '2026-10-15T03:00:00.000Z' });
  });

  it('clamps the day when the previous month is shorter', () => {
    expect(cycleOf('2026-03-31T00:00:00.000Z', new Date('2026-03-01T00:00:00Z'))).toEqual({ from: '2026-02-28T00:00:00.000Z', to: '2026-03-31T00:00:00.000Z' });
  });

  it('crosses the year boundary', () => {
    expect(cycleOf('2027-01-10T00:00:00.000Z', new Date('2026-12-20T00:00:00Z'))).toEqual({ from: '2026-12-10T00:00:00.000Z', to: '2027-01-10T00:00:00.000Z' });
  });

  it('falls back to the UTC calendar month without a period end', () => {
    expect(cycleOf(null, new Date('2026-09-25T12:00:00Z'))).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    expect(cycleOf(null, new Date('2026-12-31T23:59:59Z'))).toEqual({ from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' });
  });
});
