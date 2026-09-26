import { WhatsappSender } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { DropReason, NoticeChannel, resolveChannels } from './channels';

const target = { email: 'a@b.c', phone: '+5511999999999' };
const receivy = { sender: WhatsappSender.Receivy, instanceOpen: false, quotaLeft: 10, ownAvailable: true };
const own = { sender: WhatsappSender.Own, instanceOpen: true, quotaLeft: 0, ownAvailable: true };

describe('resolveChannels', () => {
  it('sends e-mail when wanted and possible, and drops it with a reason otherwise', () => {
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target, contact: null, whatsappAvailable: false, ...receivy })).toEqual({
      email: true,
      whatsapp: false,
      dropped: []
    });
    expect(resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target: {}, contact: null, whatsappAvailable: false, ...receivy }).dropped).toEqual([
      { channel: NoticeChannel.Email, reason: DropReason.NoEmail }
    ]);
    expect(
      resolveChannels({ wanted: { email: true, whatsapp: false }, ownBill: false, target: { ...target, email_opt_out_at: '2026-09-01T00:00:00Z' }, contact: null, whatsappAvailable: false, ...receivy })
        .dropped
    ).toEqual([{ channel: NoticeChannel.Email, reason: DropReason.OptedOut }]);
  });

  it('never wants WhatsApp on the owner own bill and reports the first blocking reason otherwise', () => {
    const wanted = { email: false, whatsapp: true };

    expect(resolveChannels({ wanted, ownBill: true, target, contact: null, whatsappAvailable: true, ...receivy })).toEqual({ email: false, whatsapp: false, dropped: [] });
    expect(resolveChannels({ wanted, ownBill: false, target: { email: 'a@b.c' }, contact: null, whatsappAvailable: true, ...receivy }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.NoPhone }
    ]);
    expect(resolveChannels({ wanted, ownBill: false, target: { email: 'a@b.c' }, contact: { phone: '+5511988887777' }, whatsappAvailable: true, ...receivy }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.NoConsent }
    ]);
    expect(
      resolveChannels({ wanted, ownBill: false, target: { ...target, whatsapp_opt_out_at: '2026-09-01T00:00:00Z' }, contact: null, whatsappAvailable: true, ...receivy }).dropped
    ).toEqual([{ channel: NoticeChannel.WhatsApp, reason: DropReason.OptedOut }]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: false, ...receivy }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.Unavailable }
    ]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true, ...receivy })).toEqual({
      email: false,
      whatsapp: true,
      phone: '+5511999999999',
      dropped: []
    });
  });

  it('drops the own sender while its instance is closed, and never checks the quota for it', () => {
    const wanted = { email: false, whatsapp: true };

    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true, ...own, instanceOpen: false }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.SenderOffline }
    ]);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true, ...own }).whatsapp).toBe(true);
  });

  it('lets the own sender through with the Receivy transport off, as long as Evolution is configured and open', () => {
    const wanted = { email: false, whatsapp: true };

    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: false, ...own }).whatsapp).toBe(true);
    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true, ...own, ownAvailable: false }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.Unavailable }
    ]);
  });

  it('drops the Receivy sender when the cycle quota is spent', () => {
    const wanted = { email: false, whatsapp: true };

    expect(resolveChannels({ wanted, ownBill: false, target, contact: null, whatsappAvailable: true, ...receivy, quotaLeft: 0 }).dropped).toEqual([
      { channel: NoticeChannel.WhatsApp, reason: DropReason.Quota }
    ]);
  });

  it('takes the contact phone with consent when the person typed none', () => {
    const resolved = resolveChannels({
      wanted: { email: false, whatsapp: true },
      ownBill: false,
      target: { email: 'a@b.c' },
      contact: { phone: '+5511988887777', consentAt: '2026-09-01T00:00:00Z' },
      whatsappAvailable: true,
      ...receivy
    });

    expect(resolved.whatsapp).toBe(true);
    expect(resolved.phone).toBe('+5511988887777');
  });
});
