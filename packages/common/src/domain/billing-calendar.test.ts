import { describe, expect, it } from 'vitest';
import { DEFAULT_BILLING_REMINDERS } from './billing';
import {
  addCalendarDays,
  billingDates,
  billingDueDates,
  civilHour,
  materializationDate,
  normalizeBillingInput,
  zonedInstant
} from './billing-calendar';

const split = { mode: 'equal' as const, parts: [{ kind: 'person' as const, personId: 'ana' }] };

describe('billing calendar', () => {
  it('clamps monthly dates to the last day without drifting', () => {
    expect(billingDates({ frequency: 'monthly', startDate: '2026-01-31' }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ]);
  });

  it('reads day and month from the start date for yearly rules and restores leap day', () => {
    expect(billingDates({ frequency: 'yearly', startDate: '2024-02-29' }, '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29'
    ]);
  });

  it('honors inclusive bounds and the limit', () => {
    expect(billingDates({ frequency: 'monthly', startDate: '2026-01-15', endDate: '2026-03-15' }, '2026-02-01', '2026-12-31')).toEqual([
      '2026-02-15',
      '2026-03-15'
    ]);
    expect(billingDates({ frequency: 'monthly', startDate: '2000-01-01' }, '2000-01-01', '2010-01-01', 3)).toHaveLength(3);
  });

  it('expands finite billings into due dates and caps them at 120', () => {
    expect(billingDueDates({ type: 'once', startDate: '2026-05-10' })).toEqual(['2026-05-10']);
    expect(billingDueDates({ type: 'until', frequency: 'monthly', startDate: '2026-01-31', endDate: '2026-03-31' })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31'
    ]);
    expect(() => billingDueDates({ type: 'until', frequency: 'monthly', startDate: '2026-01-01', endDate: '2040-01-01' })).toThrow(/120/);
    expect(() => billingDueDates({ type: 'indefinite', frequency: 'monthly', startDate: '2026-01-01' })).toThrow(/sem fim/i);
  });

  it('uses the earliest enabled reminder for materialization', () => {
    expect(
      materializationDate('2026-03-10', [
        { offsetDays: -3, enabled: true },
        { offsetDays: 2, enabled: true }
      ])
    ).toBe('2026-03-07');
    expect(materializationDate('2026-03-10', [{ offsetDays: -3, enabled: false }])).toBe('2026-03-10');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('normalizes input per type and rejects incompatible fields', () => {
    const once = normalizeBillingInput({ type: 'once', totalCents: 100, startDate: '2026-01-31', timezone: 'America/Sao_Paulo', split });
    expect(once.description).toBe('Cobrança');
    expect(once.frequency).toBeUndefined();
    expect(once.reminders).toBeUndefined();
    const until = normalizeBillingInput({
      type: 'until',
      frequency: 'monthly',
      totalCents: 100,
      startDate: '2026-01-31',
      endDate: '2026-03-31',
      timezone: 'America/Sao_Paulo',
      split,
      reminders: [
        { offsetDays: 2, enabled: true },
        { offsetDays: -3, enabled: false }
      ]
    });
    expect(until.reminders).toEqual([
      { offsetDays: -3, enabled: false },
      { offsetDays: 2, enabled: true }
    ]);
    expect(() => normalizeBillingInput({ type: 'until', totalCents: 100, startDate: '2026-01-31', timezone: 'UTC', split })).toThrow(
      /frequência/i
    );
    expect(() =>
      normalizeBillingInput({ type: 'until', frequency: 'monthly', totalCents: 100, startDate: '2026-01-31', timezone: 'UTC', split })
    ).toThrow(/data final/i);
    expect(() =>
      normalizeBillingInput({
        type: 'indefinite',
        frequency: 'monthly',
        totalCents: 100,
        startDate: '2026-01-31',
        endDate: '2026-02-01',
        timezone: 'UTC',
        split
      })
    ).toThrow(/sem fim/i);
    expect(() =>
      normalizeBillingInput({
        type: 'until',
        frequency: 'monthly',
        totalCents: 100,
        startDate: '2026-03-31',
        endDate: '2026-01-31',
        timezone: 'UTC',
        split
      })
    ).toThrow(/anterior/i);
    expect(() =>
      normalizeBillingInput({ type: 'once', totalCents: 100, startDate: '2026-01-31', timezone: 'Mars/Olympus', split })
    ).toThrow();
    expect(() =>
      normalizeBillingInput({
        type: 'once',
        totalCents: 100,
        startDate: '2026-01-31',
        timezone: 'UTC',
        split,
        reminders: [{ offsetDays: 91, enabled: true }]
      })
    ).toThrow(/lembretes/i);
  });
});

describe('zonedInstant', () => {
  it('converts a local wall-clock time to the UTC instant of that zone', () => {
    expect(zonedInstant('2026-09-10', '09:00', 'America/Sao_Paulo')).toBe('2026-09-10T12:00:00.000Z');
    expect(zonedInstant('2026-09-10', '09:00', 'America/Manaus')).toBe('2026-09-10T13:00:00.000Z');
    expect(zonedInstant('2026-09-10', '09:00', 'UTC')).toBe('2026-09-10T09:00:00.000Z');
  });
});

describe('civilHour', () => {
  it('returns the local hour of the zone', () => {
    expect(civilHour(Date.parse('2026-09-10T11:59:00Z'), 'America/Sao_Paulo')).toBe(8);
    expect(civilHour(Date.parse('2026-09-10T12:00:00Z'), 'America/Sao_Paulo')).toBe(9);
  });
});

describe('DEFAULT_BILLING_REMINDERS', () => {
  it('reminds only on the due date', () => {
    expect(DEFAULT_BILLING_REMINDERS).toEqual([{ offsetDays: 0, enabled: true }]);
  });
});
