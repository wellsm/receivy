import { describe, expect, it } from 'vitest';
import { DropReason, NoticeChannel } from './notifications';
import {
  CHANNEL_SET_OPTIONS,
  channelLabel,
  channelSetLabel,
  dropReasonText,
  NOBODY_REACHABLE,
  PREVIEW_EMPTY,
  PREVIEW_UNAVAILABLE,
  ReminderOffsetMode,
  reminderOffsetDays,
  reminderOffsetLabel,
  reminderOffsetMode,
  reminderPreviewLine,
  reminderSummary,
  remindLines,
  whatsappLockLabel
} from './reminders-copy';

describe('reminder copy', () => {
  it('labels offsets in Portuguese', () => {
    expect(reminderOffsetLabel(0)).toBe('no dia');
    expect(reminderOffsetLabel(-1)).toBe('1 dia antes');
    expect(reminderOffsetLabel(-3)).toBe('3 dias antes');
    expect(reminderOffsetLabel(1)).toBe('1 dia depois');
    expect(reminderOffsetLabel(14)).toBe('14 dias depois');
  });

  it('names channels and drop reasons', () => {
    expect(channelLabel(NoticeChannel.Push)).toBe('notificação no app');
    expect(channelLabel(NoticeChannel.Email)).toBe('e-mail');
    expect(channelLabel(NoticeChannel.WhatsApp)).toBe('WhatsApp');
    expect(dropReasonText(DropReason.NoPhone)).toBe('sem número no contato');
    expect(dropReasonText(DropReason.Unavailable)).toBe('em breve');
  });

  it('locks WhatsApp by plan first, then by availability', () => {
    expect(whatsappLockLabel({ available: false, planAllows: false })).toBe('Plano Básico');
    expect(whatsappLockLabel({ available: false, planAllows: true })).toBe('Em breve');
    expect(whatsappLockLabel({ available: true, planAllows: true })).toBeNull();
  });

  it('builds the manual reminder lines from a preview', () => {
    expect(remindLines({ channels: [NoticeChannel.Push, NoticeChannel.Push, NoticeChannel.Email], dropped: [{ channel: NoticeChannel.WhatsApp, reason: DropReason.NoPhone }] })).toEqual({
      going: 'notificação no app, e-mail',
      dropped: ['WhatsApp: sem número no contato']
    });
    expect(NOBODY_REACHABLE).toBe('Ninguém alcançável. Compartilhe o link direto.');
  });

  it('names the preview-unavailable copy', () => {
    expect(PREVIEW_UNAVAILABLE).toBe('Não foi possível conferir os avisos. Você ainda pode enviar.');
  });

  it('summarises enabled rules with their channels, skipping disabled ones', () => {
    const rules = [
      { offsetDays: -3, enabled: false, channels: { email: true, whatsapp: true } },
      { offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } },
      { offsetDays: 2, enabled: true, channels: { email: true, whatsapp: true } }
    ];

    expect(reminderSummary(rules)).toBe('no dia (e-mail), 2 dias depois (e-mail e WhatsApp)');
    expect(reminderSummary([{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: false } }])).toBe('no dia (só notificação no app)');
    expect(reminderSummary([])).toBe('nenhum lembrete');
  });

  it('names every channel set the pill can hold', () => {
    expect(CHANNEL_SET_OPTIONS.map(channelSetLabel)).toEqual(['e-mail', 'WhatsApp', 'e-mail e WhatsApp', 'só notificação no app']);
  });

  it('reads an offset as a mode and builds it back', () => {
    expect(reminderOffsetMode(-3)).toBe(ReminderOffsetMode.Before);
    expect(reminderOffsetMode(0)).toBe(ReminderOffsetMode.Due);
    expect(reminderOffsetMode(2)).toBe(ReminderOffsetMode.After);
    expect(reminderOffsetDays(ReminderOffsetMode.Before, 3)).toBe(-3);
    expect(reminderOffsetDays(ReminderOffsetMode.After, 3)).toBe(3);
    expect(reminderOffsetDays(ReminderOffsetMode.Due, 3)).toBe(0);
  });

  it('starts at one day when the mode leaves "no dia"', () => {
    expect(reminderOffsetDays(ReminderOffsetMode.Before, 0)).toBe(-1);
    expect(reminderOffsetDays(ReminderOffsetMode.After, 0)).toBe(1);
  });

  it('dates the preview against a due date, in sending order', () => {
    const rules = [
      { offsetDays: 2, enabled: true, channels: { email: false, whatsapp: true } },
      { offsetDays: -3, enabled: true, channels: { email: true, whatsapp: false } },
      { offsetDays: 0, enabled: true, channels: { email: true, whatsapp: true } },
      { offsetDays: 5, enabled: false, channels: { email: true, whatsapp: false } }
    ];

    expect(reminderPreviewLine(rules, '2026-10-20')).toBe('17/10 por e-mail · 20/10 por e-mail e WhatsApp · 22/10 por WhatsApp. Push sempre que houver app.');
    expect(reminderPreviewLine([{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: false } }], '2026-10-20')).toBe('20/10 só no app. Push sempre que houver app.');
    expect(reminderPreviewLine([], '2026-10-20')).toBe(PREVIEW_EMPTY);
  });
});
