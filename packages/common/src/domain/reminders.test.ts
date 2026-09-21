import { describe, expect, it } from 'vitest';
import {
  channelsFor,
  effectiveConfig,
  normalizeReminderRules,
  REMINDERS_INVALID_MESSAGE,
  SYSTEM_REMINDER_CONFIG,
  validateReminderConfig,
  validateReminderRules
} from './reminders';

const EMAIL = { email: true, whatsapp: false };
const BOTH = { email: true, whatsapp: true };

describe('normalizeReminderRules', () => {
  it('reads a legacy rule without channels as e-mail only', () => {
    expect(normalizeReminderRules([{ offsetDays: 0, enabled: true }])).toEqual([{ offsetDays: 0, enabled: true, channels: EMAIL }]);
  });

  it('keeps channels when present and drops unknown keys', () => {
    expect(normalizeReminderRules([{ offsetDays: 2, enabled: false, channels: BOTH, extra: 1 }])).toEqual([{ offsetDays: 2, enabled: false, channels: BOTH }]);
  });

  it('refuses anything that is not an array of rules', () => {
    expect(() => normalizeReminderRules('x')).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => normalizeReminderRules([{ offsetDays: 'a', enabled: true }])).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});

describe('validateReminderRules', () => {
  it('sorts by offset and accepts up to five unique offsets within ±14', () => {
    const rules = [-14, 14, 0, 3, -3].map((offsetDays) => ({ offsetDays, enabled: true, channels: EMAIL }));

    expect(validateReminderRules(rules).map((rule) => rule.offsetDays)).toEqual([-14, -3, 0, 3, 14]);
  });

  it('refuses six rules, duplicates, non-integers and offsets beyond 14 days', () => {
    const six = [-5, -4, -3, -2, -1, 0].map((offsetDays) => ({ offsetDays, enabled: true, channels: EMAIL }));

    expect(() => validateReminderRules(six)).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([{ offsetDays: 0, enabled: true, channels: EMAIL }, { offsetDays: 0, enabled: false, channels: EMAIL }])).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([{ offsetDays: 1.5, enabled: true, channels: EMAIL }])).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([{ offsetDays: 15, enabled: true, channels: EMAIL }])).toThrow(REMINDERS_INVALID_MESSAGE);
    expect(() => validateReminderRules([])).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});

describe('validateReminderConfig', () => {
  it('validates the rules and requires both manual channels to be booleans', () => {
    expect(validateReminderConfig(SYSTEM_REMINDER_CONFIG)).toEqual(SYSTEM_REMINDER_CONFIG);
    expect(() => validateReminderConfig({ reminders: SYSTEM_REMINDER_CONFIG.reminders, manual: { email: 'yes' as unknown as boolean, whatsapp: true } })).toThrow(REMINDERS_INVALID_MESSAGE);
  });
});

describe('effectiveConfig', () => {
  const owner = { reminders: [{ offsetDays: -3, enabled: true, channels: BOTH }], manual: { email: false, whatsapp: true } };

  it('falls back to the system default when neither level is set', () => {
    expect(effectiveConfig(null, null)).toEqual(SYSTEM_REMINDER_CONFIG);
  });

  it('uses the owner config when the billing has none', () => {
    expect(effectiveConfig(undefined, owner)).toEqual(owner);
  });

  it('takes the billing rules and always the owner manual channels', () => {
    const own = [{ offsetDays: 5, enabled: true, channels: EMAIL }];

    expect(effectiveConfig(own, owner)).toEqual({ reminders: own, manual: owner.manual });
    expect(effectiveConfig(own, null)).toEqual({ reminders: own, manual: SYSTEM_REMINDER_CONFIG.manual });
  });
});

describe('channelsFor', () => {
  const config = {
    reminders: [
      { offsetDays: -3, enabled: false, channels: BOTH },
      { offsetDays: 0, enabled: true, channels: EMAIL },
      { offsetDays: 2, enabled: true, channels: { email: false, whatsapp: true } }
    ],
    manual: { email: false, whatsapp: true }
  };

  it('picks the rule by offset for a reminder', () => {
    expect(channelsFor(config, 'reminder', 2)).toEqual({ email: false, whatsapp: true });
  });

  it('uses the first enabled rule for the initial notice, or the system rule when none is enabled', () => {
    expect(channelsFor(config, 'initial')).toEqual(EMAIL);
    expect(channelsFor({ ...config, reminders: config.reminders.map((rule) => ({ ...rule, enabled: false })) }, 'initial')).toEqual(EMAIL);
  });

  it('uses the manual channels for the manual reminder', () => {
    expect(channelsFor(config, 'manual')).toEqual({ email: false, whatsapp: true });
  });

  it('sends nothing when the reminder offset has no rule', () => {
    expect(channelsFor(config, 'reminder', 9)).toEqual({ email: false, whatsapp: false });
  });

  it('sends nothing when the matching rule is disabled', () => {
    expect(channelsFor(config, 'reminder', -3)).toEqual({ email: false, whatsapp: false });
  });
});
