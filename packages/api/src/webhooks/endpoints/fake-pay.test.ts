import { HttpNotFoundError } from '@ez4/gateway';
import { ChargeState, PaymentProvider } from '@receivy/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkoutClients, PaymentLinkMode } from '../../charges/services/payment-link';
import type { DbClient } from '../../database';
import type { CheckoutClient, CheckoutClients } from '../../vendors/checkout/types';
import { fakePayHandler } from './fake-pay';

vi.mock('../../charges/services/payment-link', async () => {
  const actual = await vi.importActual<typeof import('../../charges/services/payment-link')>('../../charges/services/payment-link');

  return { ...actual, checkoutClients: vi.fn() };
});

const ORDER_NSU = '11111111-1111-4111-8111-111111111111';

const charge = {
  id: ORDER_NSU,
  amount_cents: 1000,
  description: 'Aluguel',
  state: ChargeState.Pending,
  owner_id: 'owner',
  creditor_id: 'owner',
  debtor_id: 'payer',
  payment_snapshot: { provider: PaymentProvider.PagSeguro, value: 'Loja', label: 'Loja' }
};

const baseVariables = {
  PUBLIC_LINK_HMAC_SECRET: 'test-secret',
  PUBLIC_WEB_ORIGIN: 'https://web.example',
  NOTIFICATION_PUSH_TRANSPORT: 'disabled',
  EXPO_ACCESS_TOKEN: 'disabled',
  APP_STAGE: 'test',
  PAYMENT_CREDENTIAL_KEY_B64: 'disabled'
};

/** Same shape as `settle.test.ts`'s `dbWith`, plus a `findOne` handle to assert it was never touched. */
function dbWith(chargeRow: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const findOne = vi.fn(async () => chargeRow);
  const db = {
    transaction: async (fn: (tx: DbClient) => Promise<unknown>) => fn(db),
    charges: {
      findOne,
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);

        return chargeRow;
      })
    },
    proofs: { findMany: vi.fn(async () => ({ records: [] })) },
    events: { insertOne: vi.fn(async () => undefined), findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'payer', name: 'Ana Silva' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) }
  } as unknown as DbClient;

  return { db, updates, findOne };
}

function stubClients(check: Awaited<ReturnType<CheckoutClient['checkPayment']>>) {
  const client = { createLink: vi.fn(), checkPayment: vi.fn(async () => check), inactivate: vi.fn(), verifyCredential: vi.fn() };
  const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

  vi.mocked(checkoutClients).mockReturnValue(clients);

  return client;
}

function contextFor(db: DbClient, paymentMethodLink: string) {
  return { db, variables: { ...baseVariables, PAYMENT_METHOD_LINK: paymentMethodLink } } as unknown as Parameters<typeof fakePayHandler>[1];
}

describe('fakePayHandler', () => {
  beforeEach(() => {
    vi.mocked(checkoutClients).mockReset();
  });

  it.each([PaymentLinkMode.Live, PaymentLinkMode.Sandbox, PaymentLinkMode.Disabled])(
    'answers 404 and touches nothing for a pagseguro order when PAYMENT_METHOD_LINK is %s',
    async (mode) => {
      const { db, findOne } = dbWith(charge);

      await expect(
        fakePayHandler({ parameters: { provider: PaymentProvider.PagSeguro, orderNsu: ORDER_NSU } }, contextFor(db, mode))
      ).rejects.toThrow(HttpNotFoundError);

      expect(findOne).not.toHaveBeenCalled();
      expect(checkoutClients).not.toHaveBeenCalled();
    }
  );

  it('answers 404 and touches nothing for a provider other than pagseguro, even in fake mode', async () => {
    const { db, findOne } = dbWith(charge);

    await expect(
      fakePayHandler({ parameters: { provider: PaymentProvider.InfinitePay, orderNsu: ORDER_NSU } }, contextFor(db, PaymentLinkMode.Fake))
    ).rejects.toThrow(HttpNotFoundError);

    expect(findOne).not.toHaveBeenCalled();
    expect(checkoutClients).not.toHaveBeenCalled();
  });

  it('settles through the fake client when PAYMENT_METHOD_LINK is fake and the provider is pagseguro', async () => {
    const { db } = dbWith(charge);
    const client = stubClients({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1000, captureMethod: 'pix' });

    const response = await fakePayHandler({ parameters: { provider: PaymentProvider.PagSeguro, orderNsu: ORDER_NSU } }, contextFor(db, PaymentLinkMode.Fake));

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(client.checkPayment).toHaveBeenCalledWith(
      expect.objectContaining({ provider: PaymentProvider.PagSeguro, orderId: ORDER_NSU, credential: 'fake', transactionNsu: expect.stringMatching(/^fake-/) })
    );
  });
});
