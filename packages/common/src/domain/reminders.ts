export type ChannelSet = { email: boolean; whatsapp: boolean };

export type ReminderRule = { offsetDays: number; enabled: boolean; channels: ChannelSet };

export type ReminderConfig = { reminders: ReminderRule[]; manual: ChannelSet };

export type ReminderSettings = { config: ReminderConfig; inherited: boolean; whatsappAvailable: boolean };

export type ReminderTemplate = 'initial' | 'reminder' | 'manual';

export const REMINDER_MAX_RULES = 5;

export const REMINDER_MAX_OFFSET = 14;

export const REMINDERS_INVALID_MESSAGE = 'Lembretes inválidos: até 5 dias únicos entre -14 e 14.';

const EMAIL_ONLY: ChannelSet = { email: true, whatsapp: false };

export const SYSTEM_REMINDER_CONFIG: ReminderConfig = {
  reminders: [{ offsetDays: 0, enabled: true, channels: EMAIL_ONLY }],
  manual: { email: true, whatsapp: true }
};

function isChannelSet(value: unknown): value is ChannelSet {
  return typeof value === 'object' && value !== null && typeof (value as ChannelSet).email === 'boolean' && typeof (value as ChannelSet).whatsapp === 'boolean';
}

/** A stored rule may predate channels: it read as e-mail only. Anything else malformed is refused. */
export function normalizeReminderRules(input: unknown): ReminderRule[] {
  if (!Array.isArray(input)) {
    throw new RangeError(REMINDERS_INVALID_MESSAGE);
  }

  return input.map((item) => {
    const rule = item as Partial<ReminderRule> | null;

    if (!rule || typeof rule.offsetDays !== 'number' || typeof rule.enabled !== 'boolean') {
      throw new RangeError(REMINDERS_INVALID_MESSAGE);
    }

    const channels = rule.channels === undefined ? EMAIL_ONLY : rule.channels;

    if (!isChannelSet(channels)) {
      throw new RangeError(REMINDERS_INVALID_MESSAGE);
    }

    return { offsetDays: rule.offsetDays, enabled: rule.enabled, channels: { email: channels.email, whatsapp: channels.whatsapp } };
  });
}

/** Up to five unique integer offsets inside ±14 days, sorted ascending. */
export function validateReminderRules(rules: ReminderRule[]): ReminderRule[] {
  const invalid = rules.some(
    (rule) => !Number.isInteger(rule.offsetDays) || Math.abs(rule.offsetDays) > REMINDER_MAX_OFFSET || typeof rule.enabled !== 'boolean' || !isChannelSet(rule.channels)
  );
  const unique = new Set(rules.map((rule) => rule.offsetDays)).size === rules.length;

  if (rules.length === 0 || rules.length > REMINDER_MAX_RULES || invalid || !unique) {
    throw new RangeError(REMINDERS_INVALID_MESSAGE);
  }

  return [...rules]
    .map((rule) => ({ offsetDays: rule.offsetDays, enabled: rule.enabled, channels: { email: rule.channels.email, whatsapp: rule.channels.whatsapp } }))
    .sort((a, b) => a.offsetDays - b.offsetDays);
}

export function validateReminderConfig(config: ReminderConfig): ReminderConfig {
  if (!isChannelSet(config?.manual)) {
    throw new RangeError(REMINDERS_INVALID_MESSAGE);
  }

  return { reminders: validateReminderRules(config.reminders), manual: { email: config.manual.email, whatsapp: config.manual.whatsapp } };
}

/** billing rules ?? owner rules ?? system rules; the manual channels are always the owner's. */
export function effectiveConfig(billingReminders: ReminderRule[] | null | undefined, ownerConfig: ReminderConfig | null | undefined): ReminderConfig {
  const owner = ownerConfig ?? SYSTEM_REMINDER_CONFIG;

  return { reminders: billingReminders ?? owner.reminders, manual: owner.manual };
}

/** Which configurable channels a notice wants; push is implicit and never listed here. */
export function channelsFor(config: ReminderConfig, template: ReminderTemplate, offsetDays?: number): ChannelSet {
  if (template === 'manual') {
    return config.manual;
  }

  if (template === 'initial') {
    return config.reminders.find((rule) => rule.enabled)?.channels ?? SYSTEM_REMINDER_CONFIG.reminders[0]!.channels;
  }

  const rule = config.reminders.find((rule) => rule.offsetDays === offsetDays);

  if (!rule || !rule.enabled) {
    return { email: false, whatsapp: false };
  }

  return rule.channels;
}
