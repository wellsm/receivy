import { PaymentProvider } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { fakeCheckout, fakeLinkCount } from './fake';

const EXPIRES = '2036-01-01T00:00:00.000Z';

describe('fakeCheckout', () => {
  it('creates a PagBank link on the dev checkout page, carrying the redirect back', async () => {
    const client = fakeCheckout('https://web.example/', PaymentProvider.PagSeguro);
    const before = fakeLinkCount();

    const result = await client.createLink({
      orderNsu: 'order-1',
      amountCents: 4_200,
      description: 'Aluguel',
      expiresAt: EXPIRES,
      redirectUrl: 'https://web.example/pay/tok',
      webhookUrl: 'https://api.example/webhooks/pagseguro/tok'
    });

    expect(result).toEqual({
      status: 'created',
      url: `https://web.example/dev/checkout/pagseguro/order-1?redirect=${encodeURIComponent('https://web.example/pay/tok')}`,
      linkId: 'fake-order-1'
    });
    expect(fakeLinkCount()).toBe(before + 1);
  });

  it('pays exactly what was linked, by order id', async () => {
    const client = fakeCheckout('https://web.example', PaymentProvider.PagSeguro);

    await client.createLink({ orderNsu: 'order-2', amountCents: 1_000, description: 'Luz', expiresAt: EXPIRES });

    expect(await client.checkPayment({ provider: PaymentProvider.PagSeguro, credential: 'token', orderId: 'order-2', transactionNsu: 'tx-1' })).toEqual({
      status: 'checked',
      paid: true,
      amountCents: 1_000,
      paidAmountCents: 1_000,
      captureMethod: 'pix'
    });
  });

  it('refuses a transaction nsu starting with unpaid', async () => {
    const client = fakeCheckout('https://web.example', PaymentProvider.PagSeguro);

    await client.createLink({ orderNsu: 'order-3', amountCents: 1_000, description: 'Luz', expiresAt: EXPIRES });

    const check = await client.checkPayment({ provider: PaymentProvider.PagSeguro, credential: 'token', orderId: 'order-3', transactionNsu: 'unpaid-1' });

    expect(check).toMatchObject({ status: 'checked', paid: false });
  });

  it('accepts every credential and always inactivates', async () => {
    const client = fakeCheckout('https://web.example', PaymentProvider.PagSeguro);

    expect(await client.verifyCredential('anything')).toEqual({ status: 'valid' });
    expect(await client.inactivate({ credential: 'anything', linkId: 'fake-order-1' })).toEqual({ status: 'done' });
  });

  it('carries the InfinitePay provider in its own dev path', async () => {
    const client = fakeCheckout('https://web.example', PaymentProvider.InfinitePay);

    const result = await client.createLink({ orderNsu: 'order-4', amountCents: 100, description: 'Probe', expiresAt: EXPIRES, identity: 'loja' });

    expect(result.status === 'created' && result.url).toBe('https://web.example/dev/checkout/infinitepay/order-4');
  });
});
