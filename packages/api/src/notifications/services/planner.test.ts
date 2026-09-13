import { describe, expect, it } from 'vitest';
import { shouldSendInitialNotice } from './planner';

const TZ = 'America/Sao_Paulo';
const at = (iso: string) => Date.parse(iso);
const onDueDay = [{ offsetDays: 0, enabled: true }];

describe('shouldSendInitialNotice', () => {
  it('announces a charge due today or already late', () => {
    expect(shouldSendInitialNotice({ dueDate: '2026-03-10', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: onDueDay })).toBe(
      true
    );
    expect(shouldSendInitialNotice({ dueDate: '2026-03-01', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: [] })).toBe(true);
  });

  it('leaves a future charge to its first reminder', () => {
    expect(shouldSendInitialNotice({ dueDate: '2026-03-20', now: at('2026-03-10T15:00:00Z'), timezone: TZ, reminders: onDueDay })).toBe(
      false
    );
  });

  it('announces a future charge that no reminder will reach', () => {
    // 06:00 of the 10th in São Paulo (09:00 UTC) is already behind 15:00 UTC.
    expect(
      shouldSendInitialNotice({
        dueDate: '2026-03-11',
        now: at('2026-03-10T15:00:00Z'),
        timezone: TZ,
        reminders: [{ offsetDays: -1, enabled: true }]
      })
    ).toBe(true);
    expect(
      shouldSendInitialNotice({
        dueDate: '2026-03-20',
        now: at('2026-03-10T15:00:00Z'),
        timezone: TZ,
        reminders: [{ offsetDays: 0, enabled: false }]
      })
    ).toBe(true);
  });

  it('reads today in the billing timezone', () => {
    // 01:00 UTC of the 11th is still the 10th in São Paulo, and the reminder of the 11th is ahead.
    expect(shouldSendInitialNotice({ dueDate: '2026-03-11', now: at('2026-03-11T01:00:00Z'), timezone: TZ, reminders: onDueDay })).toBe(
      false
    );
  });
});
