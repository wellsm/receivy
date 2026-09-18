import { describe, expect, it, vi } from 'vitest';
import { createInfinitePayClient } from './client';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const link = { handle: 'loja', orderNsu: 'charge-1', items: [{ quantity: 1, price: 1000, description: 'Aluguel' }], webhookUrl: 'https://api/wh', redirectUrl: 'https://web/pay' };

describe('InfinitePay client', () => {
  it('creates a link and reads its url', async () => {
    const request = respond(200, { url: 'https://checkout.infinitepay.io/loja/abc' });
    const result = await createInfinitePayClient(request as unknown as typeof fetch).createLink(link);

    expect(result).toEqual({ status: 'created', url: 'https://checkout.infinitepay.io/loja/abc' });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.checkout.infinitepay.io/links');
    expect(JSON.parse(init.body as string)).toEqual({
      handle: 'loja',
      order_nsu: 'charge-1',
      items: [{ quantity: 1, price: 1000, description: 'Aluguel' }],
      webhook_url: 'https://api/wh',
      redirect_url: 'https://web/pay'
    });
  });

  it('turns an unknown or disabled handle into checkout_disabled with the redirect', async () => {
    const request = respond(404, { success: false, error: 'external_checkout_not_enabled', redirect_url: 'https://app.infinitepay.io/x' });

    expect(await createInfinitePayClient(request as unknown as typeof fetch).createLink(link)).toEqual({ status: 'checkout_disabled', redirectUrl: 'https://app.infinitepay.io/x' });
  });

  it('answers unavailable on any other failure, without leaking the body', async () => {
    expect(await createInfinitePayClient(respond(500, { secret: 'x' }) as unknown as typeof fetch).createLink(link)).toEqual({ status: 'unavailable' });
    expect(await createInfinitePayClient(respond(200, { nope: true }) as unknown as typeof fetch).createLink(link)).toEqual({ status: 'unavailable' });
    expect(await createInfinitePayClient(vi.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch).createLink(link)).toEqual({ status: 'unavailable' });
  });

  it('checks a payment', async () => {
    const request = respond(200, { success: true, paid: true, amount: 1000, paid_amount: 1010, installments: 1, capture_method: 'pix' });
    const result = await createInfinitePayClient(request as unknown as typeof fetch).checkPayment({ handle: 'loja', orderNsu: 'charge-1', transactionNsu: 'tx', slug: 'slug' });

    expect(result).toEqual({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1010, captureMethod: 'pix' });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.checkout.infinitepay.io/payment_check');
    expect(JSON.parse(init.body as string)).toEqual({ handle: 'loja', order_nsu: 'charge-1', transaction_nsu: 'tx', slug: 'slug' });
  });

  it('reads an unpaid check and an unavailable one', async () => {
    const unpaid = respond(200, { success: true, paid: false, amount: 1000, paid_amount: 0, installments: 0, capture_method: '' });

    expect(await createInfinitePayClient(unpaid as unknown as typeof fetch).checkPayment({ handle: 'loja', orderNsu: 'c', transactionNsu: 't', slug: 's' })).toMatchObject({ status: 'checked', paid: false });
    expect(await createInfinitePayClient(respond(502, {}) as unknown as typeof fetch).checkPayment({ handle: 'loja', orderNsu: 'c', transactionNsu: 't', slug: 's' })).toEqual({ status: 'unavailable' });
  });
});
