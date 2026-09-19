import { createHash } from 'node:crypto';
import { HttpBadRequestError } from '@ez4/gateway';
import { ChargeState, PaymentProvider } from '@receivy/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from '../../common/services/secret-box';
import type { DbClient } from '../../database';
import { checkoutClients } from '../../charges/services/payment-link';
import { issuePublicChargeToken, PublicTokenPurpose } from '../../public/services/capability';
import type { CheckoutClient, CheckoutClients } from '../../vendors/checkout/types';
import { pagSeguroWebhookHandler } from './pagseguro';

vi.mock('../../charges/services/payment-link', async () => {
  const actual = await vi.importActual<typeof import('../../charges/services/payment-link')>('../../charges/services/payment-link');

  return { ...actual, checkoutClients: vi.fn() };
});

const SECRET = 'test-public-link-secret-with-entropy';
const CREDENTIAL_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const CHARGE_ID = 'c1';

const variables = {
  PUBLIC_LINK_HMAC_SECRET: SECRET,
  PUBLIC_WEB_ORIGIN: 'https://web.example',
  NOTIFICATION_PUSH_TRANSPORT: 'disabled',
  EXPO_ACCESS_TOKEN: 'disabled',
  APP_STAGE: 'test',
  PAYMENT_METHOD_LINK: 'disabled',
  PAYMENT_CREDENTIAL_KEY_B64: CREDENTIAL_KEY
};

const charge = {
  id: CHARGE_ID,
  amount_cents: 1000,
  description: 'Aluguel',
  state: ChargeState.Pending,
  owner_id: 'owner',
  creditor_id: 'owner',
  debtor_id: 'payer',
  payment_snapshot: { provider: PaymentProvider.PagSeguro, value: 'Loja', label: 'Loja', integrationId: 'int-1' }
};

const integration = { id: 'int-1', owner_id: 'owner', provider: PaymentProvider.PagSeguro, credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) }, label: 'Loja' };

function dbWith(chargeRow: Record<string, unknown> | null, integrationRow: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
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
    integrations: { findOne: vi.fn(async () => integrationRow) },
    proofs: { findMany: vi.fn(async () => ({ records: [] })) },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => events.push(data)), findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'payer', name: 'Ana Silva' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) }
  } as unknown as DbClient;

  return { db, updates, events, findOne };
}

function tokenFor(chargeId: string) {
  return issuePublicChargeToken({ publicId: chargeId, expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600, secret: SECRET, purpose: PublicTokenPurpose.ProviderWebhook });
}

function signatureOf(credential: string, rawBody: string): string {
  return createHash('sha256').update(`${credential}-${rawBody}`).digest('hex');
}

function stubClients(check: Awaited<ReturnType<CheckoutClient['checkPayment']>>) {
  const client = { createLink: vi.fn(), checkPayment: vi.fn(async () => check), inactivate: vi.fn(), verifyCredential: vi.fn() };
  const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

  vi.mocked(checkoutClients).mockReturnValue(clients);

  return client;
}

const context = { db: undefined as unknown as DbClient, variables } as unknown as { db: DbClient; variables: typeof variables } & Record<string, unknown>;

function contextWith(db: DbClient) {
  return { ...context, db } as Parameters<typeof pagSeguroWebhookHandler>[1];
}

const paidBody = JSON.stringify({ id: 'ORDE_1', reference_id: CHARGE_ID, charges: [{ id: 'CHAR_1', status: 'PAID' }] });

describe('pagSeguroWebhookHandler', () => {
  beforeEach(() => {
    vi.mocked(checkoutClients).mockReset();
  });

  it('answers 200 and touches nothing on a bad capability token', async () => {
    const { db, findOne, events } = dbWith(charge, integration);

    const response = await pagSeguroWebhookHandler(
      { parameters: { token: 'garbage-token' }, headers: {}, body: paidBody },
      contextWith(db)
    );

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(findOne).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('answers 200 and records a rejection on a wrong signature', async () => {
    const { db, events } = dbWith(charge, integration);
    const client = stubClients({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1000, captureMethod: 'pix' });

    const response = await pagSeguroWebhookHandler(
      { parameters: { token: tokenFor(CHARGE_ID) }, headers: { 'x-authenticity-token': 'deadbeef'.repeat(8) }, body: paidBody },
      contextWith(db)
    );

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.rejected', payload: { reason: 'signature' } });
    expect(client.checkPayment).not.toHaveBeenCalled();
  });

  it('answers 200 and records ignored when there is no readable credential', async () => {
    const { db, events } = dbWith(charge, null);
    const client = stubClients({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1000, captureMethod: 'pix' });

    const response = await pagSeguroWebhookHandler(
      { parameters: { token: tokenFor(CHARGE_ID) }, headers: { 'x-authenticity-token': signatureOf('tok', paidBody) }, body: paidBody },
      contextWith(db)
    );

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.ignored', payload: { reason: 'no_credential' } });
    expect(client.checkPayment).not.toHaveBeenCalled();
  });

  it('settles a PAID charge after re-reading the order', async () => {
    const { db, updates, events } = dbWith(charge, integration);
    const client = stubClients({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1000, captureMethod: 'pix' });
    const signature = signatureOf('tok', paidBody);

    const response = await pagSeguroWebhookHandler(
      { parameters: { token: tokenFor(CHARGE_ID) }, headers: { 'x-authenticity-token': signature }, body: paidBody },
      contextWith(db)
    );

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(client.checkPayment).toHaveBeenCalledWith({ provider: PaymentProvider.PagSeguro, credential: 'tok', orderId: 'ORDE_1', transactionNsu: 'CHAR_1', chargeId: CHARGE_ID, expectedAmountCents: 1000 });
    expect(updates.at(-1)).toMatchObject({ state: ChargeState.Paid, provider_transaction_id: 'CHAR_1' });
    expect(events.at(-1)).toMatchObject({ type: 'charge.paid' });
  });

  it('ignores a notification whose reference is another charge', async () => {
    const body = JSON.stringify({ id: 'ORDE_1', reference_id: 'another-charge', charges: [{ id: 'CHAR_1', status: 'PAID' }] });
    const { db, updates, events } = dbWith(charge, integration);
    const client = stubClients({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1000, captureMethod: 'pix' });

    const response = await pagSeguroWebhookHandler(
      { parameters: { token: tokenFor(CHARGE_ID) }, headers: { 'x-authenticity-token': signatureOf('tok', body) }, body },
      contextWith(db)
    );

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(client.checkPayment).not.toHaveBeenCalled();
  });

  it('answers 400 when the order cannot be read', async () => {
    const { db } = dbWith(charge, integration);

    stubClients({ status: 'unavailable' });

    await expect(
      pagSeguroWebhookHandler(
        { parameters: { token: tokenFor(CHARGE_ID) }, headers: { 'x-authenticity-token': signatureOf('tok', paidBody) }, body: paidBody },
        contextWith(db)
      )
    ).rejects.toThrow(HttpBadRequestError);
  });

  it('answers 200 on malformed JSON after a valid signature', async () => {
    const body = 'not-json';
    const { db, events } = dbWith(charge, integration);
    const client = stubClients({ status: 'checked', paid: true, amountCents: 1000, paidAmountCents: 1000, captureMethod: 'pix' });

    const response = await pagSeguroWebhookHandler(
      { parameters: { token: tokenFor(CHARGE_ID) }, headers: { 'x-authenticity-token': signatureOf('tok', body) }, body },
      contextWith(db)
    );

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(events).toHaveLength(0);
    expect(client.checkPayment).not.toHaveBeenCalled();
  });
});
