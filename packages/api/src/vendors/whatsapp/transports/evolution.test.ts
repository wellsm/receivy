import { describe, expect, it, vi } from 'vitest';
import { createWhatsappClient } from '../compose';

const base = {
  to: '5511999999999',
  key: 'charge-1:reminder:0',
  text: 'Marina, há uma cobrança pendente.',
  template: { name: 'receivy_charge_reminder', language: { code: 'pt_BR' as const }, components: [] }
};

const message = { ...base, instance: { name: 'rcv_owner', token: 'instance-token' } };

describe('evolution transport', () => {
  it('posts free text to the owner instance with its own apikey', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ key: { id: 'BAE5', remoteJid: '5511999999999@s.whatsapp.net' }, status: 'PENDING' }, { status: 201 }));
    const client = createWhatsappClient({ EVOLUTION_API_URL: 'http://127.0.0.1:8080/' }, request);

    expect(await client.send('evolution', message)).toEqual({ status: 'accepted', id: 'BAE5' });
    expect(request).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/message/sendText/rcv_owner',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'instance-token' }),
        body: JSON.stringify({ number: '5511999999999', text: message.text })
      })
    );
  });

  it('is permanent without an instance or when the instance is gone, transient on outages', async () => {
    const request = vi.fn<typeof fetch>();
    const client = createWhatsappClient({ EVOLUTION_API_URL: 'http://127.0.0.1:8080' }, request);

    expect(await client.send('evolution', base)).toEqual({ status: 'permanent' });
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValueOnce(Response.json({ status: 404, error: 'Not Found' }, { status: 404 }));
    expect(await client.send('evolution', message)).toEqual({ status: 'permanent' });
    request.mockResolvedValueOnce(Response.json({ status: 400, response: { message: ['Connection Closed'] } }, { status: 400 }));
    expect(await client.send('evolution', message)).toEqual({ status: 'permanent' });
    request.mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect(await client.send('evolution', message)).toEqual({ status: 'transient' });
    request.mockResolvedValueOnce(Response.json({ status: 'PENDING' }, { status: 201 }));
    expect(await client.send('evolution', message)).toEqual({ status: 'transient' });
    request.mockRejectedValueOnce(new Error('lost'));
    expect(await client.send('evolution', message)).toEqual({ status: 'transient' });
  });
});
