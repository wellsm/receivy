import { describe, expect, it, vi } from 'vitest';
import { createPagSeguroClient, PagSeguroHost } from './client';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('PagSeguro client', () => {
  it('verifies a token by probing a checkout that cannot exist', async () => {
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, respond(401, { error_messages: [{ error: 'invalid_authorization_header' }] }) as unknown as typeof fetch).verifyToken('t')).toEqual({ status: 'invalid' });
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, respond(404, {}) as unknown as typeof fetch).verifyToken('t')).toEqual({ status: 'valid' });
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, respond(200, { id: 'CHEC_x' }) as unknown as typeof fetch).verifyToken('t')).toEqual({ status: 'valid' });
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, respond(503, {}) as unknown as typeof fetch).verifyToken('t')).toEqual({ status: 'unavailable' });
  });

  it('creates a checkout and reads the PAY link', async () => {
    const request = respond(201, { id: 'CHEC_1', status: 'ACTIVE', links: [{ rel: 'SELF', href: 'https://api/CHEC_1', method: 'GET' }, { rel: 'PAY', href: 'https://pagamento.pagbank.com.br/pagamento?code=abc', method: 'GET' }] });
    const result = await createPagSeguroClient(PagSeguroHost.Live, request as unknown as typeof fetch).createCheckout('tok', { referenceId: 'c1', amountCents: 1250, description: 'Aluguel', expiresAt: '2026-12-18T00:00:00.000Z', redirectUrl: 'https://web/pay/x?returned=1', webhookUrl: 'https://api/webhooks/pagseguro/tok' });

    expect(result).toEqual({ status: 'created', id: 'CHEC_1', url: 'https://pagamento.pagbank.com.br/pagamento?code=abc' });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.pagseguro.com/checkouts');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      reference_id: 'c1',
      expiration_date: '2026-12-18T00:00:00.000Z',
      customer_modifiable: true,
      items: [{ reference_id: 'c1', name: 'Aluguel', quantity: 1, unit_amount: 1250 }],
      payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }],
      soft_descriptor: 'Receivy',
      redirect_url: 'https://web/pay/x?returned=1',
      notification_urls: ['https://api/webhooks/pagseguro/tok']
    });
  });

  it('maps 401 to unauthorized and everything else to unavailable, never leaking the body', async () => {
    const input = { referenceId: 'c1', amountCents: 1, description: 'x', expiresAt: 'e', redirectUrl: 'r', webhookUrl: 'w' };
    const client = (status: number, body: unknown) => createPagSeguroClient(PagSeguroHost.Sandbox, respond(status, body) as unknown as typeof fetch);

    expect(await client(401, { secret: 1 }).createCheckout('t', input)).toEqual({ status: 'unauthorized' });
    expect(await client(400, {}).createCheckout('t', input)).toEqual({ status: 'unavailable' });
    expect(await client(201, { id: 'CHEC_1', links: [] }).createCheckout('t', input)).toEqual({ status: 'unavailable' });
  });

  it('reads an order and its charges', async () => {
    const result = await createPagSeguroClient(PagSeguroHost.Sandbox, respond(200, { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'PAID', amount: { value: 1250, summary: { paid: 1250 } }, payment_method: { type: 'PIX' } }] }) as unknown as typeof fetch).getOrder('t', 'ORDE_1');

    expect(result).toEqual({ status: 'found', charges: [{ id: 'CHAR_1', status: 'PAID', amountCents: 1250, paidCents: 1250, method: 'PIX' }] });
  });

  it('maps getOrder 401 to unauthorized and 503 to unavailable', async () => {
    const client = (status: number, body: unknown) => createPagSeguroClient(PagSeguroHost.Sandbox, respond(status, body) as unknown as typeof fetch);

    expect(await client(401, {}).getOrder('t', 'ORDE_1')).toEqual({ status: 'unauthorized' });
    expect(await client(503, {}).getOrder('t', 'ORDE_1')).toEqual({ status: 'unavailable' });
  });

  it('maps inactivate 401 to unauthorized and 400 to unavailable', async () => {
    const client = (status: number, body: unknown) => createPagSeguroClient(PagSeguroHost.Sandbox, respond(status, body) as unknown as typeof fetch);

    expect(await client(401, {}).inactivate('t', 'CHEC_1')).toEqual({ status: 'unauthorized' });
    expect(await client(400, {}).inactivate('t', 'CHEC_1')).toEqual({ status: 'unavailable' });
  });

  it('answers unavailable when request rejects for any method', async () => {
    const failing = vi.fn(async () => { throw new Error('boom'); });

    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, failing as unknown as typeof fetch).verifyToken('t')).toEqual({ status: 'unavailable' });
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, failing as unknown as typeof fetch).createCheckout('t', { referenceId: 'c1', amountCents: 1, description: 'x', expiresAt: 'e', redirectUrl: 'r', webhookUrl: 'w' })).toEqual({ status: 'unavailable' });
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, failing as unknown as typeof fetch).getOrder('t', 'ORDE_1')).toEqual({ status: 'unavailable' });
    expect(await createPagSeguroClient(PagSeguroHost.Sandbox, failing as unknown as typeof fetch).inactivate('t', 'CHEC_1')).toEqual({ status: 'unavailable' });
  });

  it('truncates long descriptions in createCheckout to 100 chars', async () => {
    const longDesc = 'a'.repeat(150);
    const request = respond(201, { id: 'CHEC_1', status: 'ACTIVE', links: [{ rel: 'PAY', href: 'https://example.com/pay' }] });

    await createPagSeguroClient(PagSeguroHost.Live, request as unknown as typeof fetch).createCheckout('tok', { referenceId: 'c1', amountCents: 1, description: longDesc, expiresAt: 'e', redirectUrl: 'r', webhookUrl: 'w' });

    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { items: { name: string }[] };

    expect(body.items[0]!.name).toBe('a'.repeat(100));
    expect(body.items[0]!.name.length).toBe(100);
  });

  it('inactivates a checkout', async () => {
    const request = respond(200, { id: 'CHEC_1', status: 'INACTIVE' });

    expect(await createPagSeguroClient(PagSeguroHost.Live, request as unknown as typeof fetch).inactivate('t', 'CHEC_1')).toEqual({ status: 'done' });
    expect((request.mock.calls[0] as unknown as [string])[0]).toBe('https://api.pagseguro.com/checkouts/CHEC_1/inactivate');
  });
});
