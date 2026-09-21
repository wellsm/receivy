import { effectiveConfig, normalizeReminderRules, type ReminderConfig, type ReminderRule, validateReminderConfig } from '@receivy/common';

type ReminderRow = { reminders?: string; owner: { reminder_config?: string } };

/** Kept apart from the repository so the notifier can read reminder settings without importing it. */
export function parseReminders(row: { reminders?: string }): ReminderRule[] | undefined {
  return row.reminders ? normalizeReminderRules(JSON.parse(row.reminders)) : undefined;
}

export function parseReminderConfig(json?: string): ReminderConfig | null {
  if (!json) {
    return null;
  }

  const parsed = JSON.parse(json) as ReminderConfig;

  return validateReminderConfig({ reminders: normalizeReminderRules(parsed.reminders), manual: parsed.manual });
}

/** The rules that fire for this billing: its own, else the owner's default, else the system's. */
export function effectiveReminders(row: ReminderRow): ReminderRule[] {
  return effectiveConfigOf(row).reminders;
}

export function effectiveConfigOf(row: ReminderRow): ReminderConfig {
  return effectiveConfig(parseReminders(row), parseReminderConfig(row.owner.reminder_config));
}

export function serializeReminderConfig(config: ReminderConfig): string {
  return JSON.stringify(validateReminderConfig(config));
}
