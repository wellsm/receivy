import { describe, expect, it } from 'vitest';
import { currentMonth, monthLabel, monthTabs, shiftMonth } from './feed-month';

describe('feed month', () => {
  it('reads the current month from today, respecting the timezone', () => {
    expect(currentMonth(new Date('2026-09-01T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-08');
    expect(currentMonth(new Date('2026-09-01T14:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09');
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-06', 12)).toBe('2027-06');
    expect(shiftMonth('2026-06', -24)).toBe('2024-06');
  });

  it('labels a month as a 3-letter pt-BR abbreviation over a 2-digit year', () => {
    expect(monthLabel('2026-08')).toBe('ago/26');
    expect(monthLabel('2026-09')).toBe('set/26');
    expect(monthLabel('2026-10')).toBe('out/26');
    expect(monthLabel('2027-01')).toBe('jan/27');
  });

  it('rejects a malformed month', () => {
    expect(() => shiftMonth('2026-13', 0)).toThrow(/mês inválido/i);
    expect(() => monthLabel('26-09')).toThrow(/mês inválido/i);
  });

  it('builds previous, selected and next month tabs', () => {
    expect(monthTabs('2026-09')).toEqual([
      { value: '2026-08', label: 'ago/26', selected: false },
      { value: '2026-09', label: 'set/26', selected: true },
      { value: '2026-10', label: 'out/26', selected: false }
    ]);
  });

  it('carries a tab across a year boundary', () => {
    expect(monthTabs('2026-01')).toEqual([
      { value: '2025-12', label: 'dez/25', selected: false },
      { value: '2026-01', label: 'jan/26', selected: true },
      { value: '2026-02', label: 'fev/26', selected: false }
    ]);
  });
});
