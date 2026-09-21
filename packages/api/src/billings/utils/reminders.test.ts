import { REMINDERS_INVALID_MESSAGE, SYSTEM_REMINDER_CONFIG } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { effectiveConfigOf, effectiveReminders, parseReminderConfig, parseReminders } from './reminders';

const owner = { reminders: [{ offsetDays: -3, enabled: true, channels: { email: true, whatsapp: true } }], manual: { email: false, whatsapp: true } };

describe('billing reminder resolution', () => {
  it('reads legacy rows as e-mail only', () => {
    expect(parseReminders({ reminders: '[{"offsetDays":0,"enabled":true}]' })).toEqual([{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }]);
  });

  it('inherits the owner config when the billing has none, else the system default', () => {
    expect(effectiveReminders({ owner: { reminder_config: JSON.stringify(owner) } })).toEqual(owner.reminders);
    expect(effectiveReminders({ owner: {} })).toEqual(SYSTEM_REMINDER_CONFIG.reminders);
  });

  it('keeps the billing rules and the owner manual channels', () => {
    const own = '[{"offsetDays":5,"enabled":true,"channels":{"email":true,"whatsapp":false}}]';

    expect(effectiveConfigOf({ reminders: own, owner: { reminder_config: JSON.stringify(owner) } })).toEqual({ reminders: JSON.parse(own), manual: owner.manual });
    expect(parseReminderConfig(undefined)).toBeNull();
  });

  it('refuses a stored row without a manual channel set', () => {
    const malformed = JSON.stringify({ reminders: owner.reminders });

    expect(() => parseReminderConfig(malformed)).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});
