import { PaymentProvider } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { PagSeguroClient } from '../pagseguro/types';
import { pagSeguroCheckout } from './pagseguro';

function clientWith(overrides: Partial<PagSeguroClient> = {}): PagSeguroClient {
  return {
    verifyToken: vi.fn(),
    createCheckout: vi.fn(),
    getOrder: vi.fn(async () => ({ status: 'found' as const, referenceId: 'c1', charges: [{ id: 'CHAR_1', status: 'PAID', amountCents: 1_000, paidCents: 1_000, method: 'PIX' }] })),
    inactivate: vi.fn(),
    ...overrides
  };
}

describe('pagSeguroCheckout', () => {
  it('reports paid when the transaction and the reference id both match the charge', async () => {
    const client = pagSeguroCheckout(clientWith());

    const result = await client.checkPayment({ provider: PaymentProvider.PagSeguro, credential: 'tok', orderId: 'ORDE_1', transactionNsu: 'CHAR_1', chargeId: 'c1', expectedAmountCents: 1000 });

    expect(result).toEqual({ status: 'checked', paid: true, amountCents: 1_000, paidAmountCents: 1_000, captureMethod: 'pix' });
  });

  it('never settles when the order reference id points at another charge', async () => {
    const client = pagSeguroCheckout(clientWith());

    const result = await client.checkPayment({ provider: PaymentProvider.PagSeguro, credential: 'tok', orderId: 'ORDE_1', transactionNsu: 'CHAR_1', chargeId: 'c2', expectedAmountCents: 1000 });

    expect(result).toEqual({ status: 'checked', paid: false, amountCents: 0, paidAmountCents: 0, captureMethod: '' });
  });

  it('still settles when the order carries no reference id at all', async () => {
    const client = pagSeguroCheckout(
      clientWith({ getOrder: vi.fn(async () => ({ status: 'found' as const, charges: [{ id: 'CHAR_1', status: 'PAID', amountCents: 1_000, paidCents: 1_000, method: 'PIX' }] })) })
    );

    const result = await client.checkPayment({ provider: PaymentProvider.PagSeguro, credential: 'tok', orderId: 'ORDE_1', transactionNsu: 'CHAR_1', chargeId: 'c2', expectedAmountCents: 1000 });

    expect(result).toMatchObject({ status: 'checked', paid: true });
  });
});
