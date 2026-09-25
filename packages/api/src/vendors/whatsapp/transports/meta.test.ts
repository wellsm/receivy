import { describe, expect, it, vi } from 'vitest';
import { createWhatsappClient } from '../compose';
import { isPermanentMetaError } from './meta';

const message = {
  to: '5511999999999',
  key: 'charge-1:reminder:0',
  text: 'Olá',
  template: { name: 'receivy_charge_reminder', language: { code: 'pt_BR' as const }, components: [] }
};

const env = { WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_API_VERSION: 'v21.0' };

describe('meta transport', () => {
  it('posts the template to the Graph API and returns the wamid', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.1' }] }));
    const client = createWhatsappClient(env, request);

    expect(await client.send('meta', message)).toEqual({ status: 'accepted', id: 'wamid.1' });
    expect(request).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: message.to, type: 'template', template: message.template })
      })
    );
  });

  it('answers permanent without a token and classifies Meta errors by code', async () => {
    const request = vi.fn<typeof fetch>();

    expect(await createWhatsappClient({ WHATSAPP_ACCESS_TOKEN: 'disabled', WHATSAPP_PHONE_NUMBER_ID: '123' }, request).send('meta', message)).toEqual({ status: 'permanent' });
    expect(request).not.toHaveBeenCalled();

    const client = createWhatsappClient(env, request);

    request.mockResolvedValueOnce(Response.json({ error: { code: 131026, message: 'not a whatsapp user' } }, { status: 400 }));
    expect(await client.send('meta', message)).toEqual({ status: 'permanent' });
    request.mockResolvedValueOnce(Response.json({ error: { code: 130429, message: 'rate limit' } }, { status: 400 }));
    expect(await client.send('meta', message)).toEqual({ status: 'transient' });
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await client.send('meta', message)).toEqual({ status: 'transient' });
    request.mockResolvedValueOnce(Response.json({ messages: [] }));
    expect(await client.send('meta', message)).toEqual({ status: 'transient' });
    request.mockRejectedValueOnce(new Error('provider secret body must not escape'));
    expect(await client.send('meta', message)).toEqual({ status: 'transient' });
  });

  it('knows the whole template error range as permanent', () => {
    expect(isPermanentMetaError(132000)).toBe(true);
    expect(isPermanentMetaError(132015)).toBe(true);
    expect(isPermanentMetaError(131047)).toBe(true);
    expect(isPermanentMetaError(131048)).toBe(false);
  });
});
