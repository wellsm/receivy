import { shiftDays, shortDayMonth } from './calendar-labels';
import { DropReason, type ManualReminderResult, NoticeChannel } from './notifications';
import type { ChannelSet, ReminderRule } from './reminders';

export function reminderOffsetLabel(offsetDays: number): string {
  if (offsetDays === 0) {
    return 'no dia';
  }

  const days = Math.abs(offsetDays);
  const unit = days === 1 ? 'dia' : 'dias';

  return `${days} ${unit} ${offsetDays < 0 ? 'antes' : 'depois'}`;
}

const CHANNEL_LABELS: Record<NoticeChannel, string> = {
  [NoticeChannel.Push]: 'notificação no app',
  [NoticeChannel.Email]: 'e-mail',
  [NoticeChannel.WhatsApp]: 'WhatsApp'
};

export function channelLabel(channel: NoticeChannel): string {
  return CHANNEL_LABELS[channel];
}

const DROP_TEXTS: Record<DropReason, string> = {
  [DropReason.NoEmail]: 'sem e-mail',
  [DropReason.NoPhone]: 'sem número no contato',
  [DropReason.NoConsent]: 'sem consentimento no contato',
  [DropReason.OptedOut]: 'a pessoa pediu para não receber',
  [DropReason.Unavailable]: 'em breve'
};

export function dropReasonText(reason: DropReason): string {
  return DROP_TEXTS[reason];
}

/** How a rule reads in the assembled sentence: "e-mail e WhatsApp", or the implicit channel when none is picked. */
export function channelSetLabel(channels: ChannelSet): string {
  const names = [...(channels.email ? ['e-mail'] : []), ...(channels.whatsapp ? ['WhatsApp'] : [])];

  if (!names.length) {
    return 'só notificação no app';
  }

  return names.join(' e ');
}

/** The four states the channel pill offers, in the order the picker shows them. */
export const CHANNEL_SET_OPTIONS: ChannelSet[] = [
  { email: true, whatsapp: false },
  { email: false, whatsapp: true },
  { email: true, whatsapp: true },
  { email: false, whatsapp: false }
];

export const enum ReminderOffsetMode {
  Before = 'before',
  Due = 'due',
  After = 'after'
}

export const REMINDER_OFFSET_MODE_LABELS: Record<ReminderOffsetMode, string> = {
  [ReminderOffsetMode.Before]: 'antes',
  [ReminderOffsetMode.Due]: 'no dia',
  [ReminderOffsetMode.After]: 'depois'
};

export function reminderOffsetMode(offsetDays: number): ReminderOffsetMode {
  if (offsetDays < 0) {
    return ReminderOffsetMode.Before;
  }

  if (offsetDays > 0) {
    return ReminderOffsetMode.After;
  }

  return ReminderOffsetMode.Due;
}

/** The signed offset a mode and a day count mean; "no dia" ignores the count, and a switch away from it starts at one day. */
export function reminderOffsetDays(mode: ReminderOffsetMode, days: number): number {
  if (mode === ReminderOffsetMode.Due) {
    return 0;
  }

  const magnitude = Math.max(1, Math.abs(days));

  return mode === ReminderOffsetMode.Before ? -magnitude : magnitude;
}

export const PREVIEW_PUSH_NOTE = 'Push sempre que houver app.';

export const PREVIEW_EMPTY = `Nenhum lembrete automático. ${PREVIEW_PUSH_NOTE}`;

/** The preview block: one date per enabled rule against a due date, in the order they go out. */
export function reminderPreviewLine(rules: ReminderRule[], dueDate: string): string {
  const enabled = rules.filter((rule) => rule.enabled).sort((a, b) => a.offsetDays - b.offsetDays);

  if (!enabled.length) {
    return PREVIEW_EMPTY;
  }

  const parts = enabled.map((rule) => {
    const day = shortDayMonth(shiftDays(dueDate, rule.offsetDays));

    if (!rule.channels.email && !rule.channels.whatsapp) {
      return `${day} só no app`;
    }

    return `${day} por ${channelSetLabel(rule.channels)}`;
  });

  return `${parts.join(' · ')}. ${PREVIEW_PUSH_NOTE}`;
}

/** One line for cards and the inherited block: "no dia (e-mail), 2 dias depois (e-mail e WhatsApp)". */
export function reminderSummary(rules: ReminderRule[]): string {
  const enabled = rules.filter((rule) => rule.enabled);

  if (!enabled.length) {
    return 'nenhum lembrete';
  }

  return enabled.map((rule) => `${reminderOffsetLabel(rule.offsetDays)} (${channelSetLabel(rule.channels)})`).join(', ');
}

export const PUSH_DISCLAIMER = 'Notificação no app vai sempre que a pessoa permitir no celular dela.';

export const NOBODY_REACHABLE = 'Ninguém alcançável. Compartilhe o link direto.';

/** Preview request failed or is unavailable: the send button stays enabled, just without a channel preview. */
export const PREVIEW_UNAVAILABLE = 'Não foi possível conferir os avisos. Você ainda pode enviar.';

/** The plan lock wins over the transport lock: a free user sees the upsell, a paid one sees "Em breve". */
export function whatsappLockLabel(gate: { available: boolean; planAllows: boolean }): string | null {
  if (!gate.planAllows) {
    return 'Plano Básico';
  }

  if (!gate.available) {
    return 'Em breve';
  }

  return null;
}

/** What the manual-reminder confirm shows: the channels going out (push once, however many devices) and one line per drop. */
export function remindLines(preview: ManualReminderResult): { going: string; dropped: string[] } {
  const going = [...new Set(preview.channels)].map(channelLabel).join(', ');
  const dropped = preview.dropped.map((drop) => `${channelLabel(drop.channel).replace(/^./, (c) => c.toUpperCase())}: ${dropReasonText(drop.reason)}`);

  return { going, dropped };
}
