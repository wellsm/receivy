import { describe, expect, it } from 'vitest';
import { DropReason, NoticeChannel } from './notifications';
import { channelLabel, dropReasonText, NOBODY_REACHABLE, PREVIEW_UNAVAILABLE, reminderOffsetLabel, reminderSummary, remindLines, whatsappLockLabel } from './reminders-copy';

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
});
