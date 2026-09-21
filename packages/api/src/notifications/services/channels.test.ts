import { describe, expect, it } from 'vitest';
import { DropReason, NoticeChannel, resolveChannels } from './channels';

const target = { email: 'a@b.c', phone: '+5511999999999' };

describe('resolveChannels', () => {
  it('sends e-mail when wanted and possible, and drops it with a reason otherwise', () => {
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target, contact: null, whatsappAvailable: false })).toEqual({
      email: true,
      whatsapp: false,
      dropped: []
    });
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target: {}, contact: null, whatsappAvailable: false }).dropped).toEqual([
      { channel: NoticeChannel.Email, reason: DropReason.NoEmail }
    ]);
    expect(
      resolveChannels({
        wanted: { email: true, whatsapp: false },
        ownBill: false,
        target: { ...target, email_opt_out_at: '2026-09-01T00:00:00Z' },
        contact: null,
        whatsappAvailable: false
      }).dropped
    ).toEqual([{ channel: NoticeChannel.Email, reason: DropReason.OptedOut }]);
  });

  it('never wants WhatsApp on the owner own bill and reports the first blocking reason otherwise', () => {
    const wanted = { email: false, whatsapp: true };

    expect(resolveChannels({ wanted, ownBill: true, target, contact: null, whatsappAvailable: true })).toEqual({ email: false, whatsapp: false, dropped: [] });
    expect(resolveChannels({ wanted, ownBill: false, target: { email: 'a@b.c' }, contact: null, whatsappAvailable: true }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.NoPhone }
    ]);
    expect(resolveChannels({ wanted, ownBill: false, target: { email: 'a@b.c' }, contact: { phone: '+5511988887777' }, whatsappAvailable: true }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.NoConsent }
    ]);
    expect(
      resolveChannels({ wanted, ownBill: false, target: { ...target, whatsapp_opt_out_at: '2026-09-01T00:00:00Z' }, contact: null, whatsappAvailable: true }).dropped
    ).toEqual([{ channel: NoticeChannel.WhatsApp, reason: DropReason.OptedOut }]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: false }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.Unavailable }
    ]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true })).toEqual({ email: false, whatsapp: true, dropped: [] });
  });

  it('takes the contact phone with consent when the person typed none', () => {
    expect(
      resolveChannels({
        wanted: { email: false, whatsapp: true },
        ownBill: false,
        target: { email: 'a@b.c' },
        contact: { phone: '+5511988887777', consentAt: '2026-09-01T00:00:00Z' },
        whatsappAvailable: true
      }).whatsapp
    ).toBe(true);
  });
});
