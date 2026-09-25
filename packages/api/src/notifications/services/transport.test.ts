import { describe, expect, it, vi } from 'vitest';
import { WhatsappSender } from '@receivy/common';
import { createWhatsappClient } from '../../vendors/whatsapp/compose';
import { notificationTransport } from './transport';

const email = {
  to: 'fixture@example.com',
  from: 'Receivy <test@example.com>',
  key: 'stable-key',
  subject: 'Test',
  text: 'Body'
};

describe('notification provider boundaries', () => {
  it.each([401, 403])('does not treat receipt-query HTTP %s as failed delivery', async (status) => {
    const sender = notificationTransport({ NOTIFICATION_PUSH_TRANSPORT: 'expo' }, async () => new Response(null, { status }));

    expect(await sender.receipt('accepted-ticket')).toEqual({
      status: 'observation_failed'
    });
  });
  it('does not treat a malformed receipt as a definitive negative receipt', async () => {
    const sender = notificationTransport({ NOTIFICATION_PUSH_TRANSPORT: 'expo' }, async () =>
      Response.json({ data: { ticket: { status: 'unknown' } } })
    );

    expect(await sender.receipt('ticket')).toEqual({
      status: 'observation_failed'
    });
  });
  it('keeps disabled explicit and sends stable Resend key/body, classifying failures', async () => {
    const request = vi.fn<typeof fetch>();
    const disabled = notificationTransport({}, request);

    expect(await disabled.email(email)).toEqual({ status: 'disabled' });
    expect(request).not.toHaveBeenCalled();

    const sender = notificationTransport({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'fake-key' }, request);

    request.mockResolvedValueOnce(Response.json({ id: 'email-id' }));
    expect(await sender.email(email)).toEqual({
      status: 'accepted',
      id: 'email-id'
    });
    expect(request).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'stable-key' }),
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          subject: email.subject,
          text: email.text
        })
      })
    );
    request.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await sender.email(email)).toEqual({ status: 'permanent' });
    request.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect(await sender.email(email)).toEqual({ status: 'transient' });
    request.mockRejectedValueOnce(new Error('provider secret body must not escape'));
    expect(await sender.email(email)).toEqual({ status: 'uncertain' });
  });
  it('separates Expo acceptance from receipts and classifies device revocation and lost response', async () => {
    const request = vi.fn<typeof fetch>();
    const sender = notificationTransport({ NOTIFICATION_PUSH_TRANSPORT: 'expo' }, request);
    const push = {
      token: 'ExpoPushToken[fixture]',
      title: 'Reminder',
      body: 'Generic',
      url: 'https://receivy.example/pay/fixture'
    };

    request.mockResolvedValueOnce(Response.json({ data: { status: 'ok', id: 'ticket' } }));
    expect(await sender.push(push)).toEqual({
      status: 'accepted',
      id: 'ticket'
    });
    request.mockResolvedValueOnce(Response.json({ data: {} }));
    expect(await sender.receipt('ticket')).toEqual({ status: 'pending' });
    expect(request).toHaveBeenLastCalledWith(
      'https://exp.host/--/api/v2/push/getReceipts',
      expect.objectContaining({ body: '{"ids":["ticket"]}' })
    );
    request.mockResolvedValueOnce(
      Response.json({
        data: {
          ticket: {
            status: 'error',
            details: { error: 'DeviceNotRegistered' }
          }
        }
      })
    );
    expect(await sender.receipt('ticket')).toEqual({
      status: 'device_unregistered'
    });
    request.mockRejectedValueOnce(new Error('lost'));
    expect(await sender.push(push)).toEqual({ status: 'uncertain' });
  });
});

const whatsapp = {
  to: '5511999999999',
  key: 'charge:reminder:0',
  text: 'Olá',
  template: { name: 'receivy_charge_reminder', language: { code: 'pt_BR' as const }, components: [] }
};

describe('notification transport: whatsapp', () => {
  it('is disabled without WHATSAPP_TRANSPORT and routes the Receivy sender through it', async () => {
    const request = vi.fn<typeof fetch>();

    expect(await notificationTransport({}, request).whatsapp({ ...whatsapp, sender: WhatsappSender.Receivy })).toEqual({ status: 'disabled' });
    expect(request).not.toHaveBeenCalled();

    const env = { WHATSAPP_TRANSPORT: 'meta', WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_PHONE_NUMBER_ID: '123' };
    const sender = notificationTransport(env, request, undefined, createWhatsappClient(env, request));

    request.mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.9' }] }));
    expect(await sender.whatsapp({ ...whatsapp, sender: WhatsappSender.Receivy })).toEqual({ status: 'accepted', id: 'wamid.9' });
    expect(String(request.mock.calls[0]?.[0])).toBe('https://graph.facebook.com/v21.0/123/messages');
  });

  it('always routes the own sender through evolution, whatever WHATSAPP_TRANSPORT says', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ key: { id: 'BAE1' } }, { status: 201 }));
    const env = { WHATSAPP_TRANSPORT: 'meta', WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_PHONE_NUMBER_ID: '123', EVOLUTION_API_URL: 'http://evo' };
    const sender = notificationTransport(env, request, undefined, createWhatsappClient(env, request));

    expect(await sender.whatsapp({ ...whatsapp, sender: WhatsappSender.Own, instance: { name: 'rcv_a', token: 't' } })).toEqual({ status: 'accepted', id: 'BAE1' });
    expect(String(request.mock.calls[0]?.[0])).toBe('http://evo/message/sendText/rcv_a');
  });
});
