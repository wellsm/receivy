import { DropReason, type ManualReminderResult, NoticeChannel } from './notifications';
import type { ReminderRule } from './reminders';

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

function ruleChannels(rule: ReminderRule): string {
  const names = [...(rule.channels.email ? ['e-mail'] : []), ...(rule.channels.whatsapp ? ['WhatsApp'] : [])];

  if (!names.length) {
    return 'só notificação no app';
  }

  return names.join(' e ');
}

/** One line for cards and the inherited block: "no dia (e-mail), 2 dias depois (e-mail e WhatsApp)". */
export function reminderSummary(rules: ReminderRule[]): string {
  const enabled = rules.filter((rule) => rule.enabled);

  if (!enabled.length) {
    return 'nenhum lembrete';
  }

  return enabled.map((rule) => `${reminderOffsetLabel(rule.offsetDays)} (${ruleChannels(rule)})`).join(', ');
}

export const PUSH_DISCLAIMER = 'Notificação no app vai sempre que a pessoa permitir no celular dela.';

export const NOBODY_REACHABLE = 'Ninguém alcançável. Compartilhe o link direto.';

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
