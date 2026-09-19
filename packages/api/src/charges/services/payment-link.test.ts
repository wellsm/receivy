import { ChargeState, PaymentLinkState, PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { seal } from '../../common/services/secret-box';
import type { DbClient } from '../../database';
import type { CheckoutClient, CheckoutClients } from '../../vendors/checkout/types';
import { checkoutClients, ensurePaymentLink, inactivatePaymentLink, type PaymentLinkConfig, webhookToken } from './payment-link';

const config: PaymentLinkConfig = {
  apiOrigin: 'https://api.example/receivy',
  webOrigin: 'https://web.example',
  secret: 'test-payment-link-secret-with-entropy',
  credentialKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
};

function dbWith(charge: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const db = {
    charges: {
      findOne: vi.fn(async () => charge),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);

        return charge;
      })
    },
    links: {
      findMany: vi.fn(async () => ({ records: [{ id: 'l', public_id: 'pub', linkable_type: 'charge', linkable_id: charge['id'], expires_at: '2036-01-01T00:00:00.000Z' }] })),
      insertOne: vi.fn()
    },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => events.push(data)) }
  } as unknown as DbClient;

  return { db, updates, events };
}

const infinitePay = { id: 'c1', amount_cents: 1250, description: 'Aluguel', state: ChargeState.Pending, owner_id: 'owner', payment_snapshot: { provider: PaymentProvider.InfinitePay, value: 'loja', label: 'InfinitePay' } };

const CREDENTIAL_KEY = config.credentialKeyB64;

const pagSeguro = {
  id: 'c1',
  amount_cents: 1250,
  description: 'Aluguel',
  state: ChargeState.Pending,
  owner_id: 'owner',
  payment_snapshot: { provider: PaymentProvider.PagSeguro, value: 'Loja', label: 'Loja', integrationId: 'int-1' }
};

/** Extends a `dbWith` mock with the integration row `credentialOf` reads. */
function withIntegration(db: DbClient, integration: Record<string, unknown> | null) {
  return Object.assign(db, { integrations: { findOne: vi.fn(async () => integration) } });
}

/** The same mock stands behind both providers: the charge's snapshot decides which one is asked. */
function provider(result: Awaited<ReturnType<CheckoutClient['createLink']>>) {
  const client = { createLink: vi.fn(async () => result), checkPayment: vi.fn(), inactivate: vi.fn(), verifyCredential: vi.fn() };
  const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

  return Object.assign(clients, { createLink: client.createLink as ReturnType<typeof vi.fn> });
}

describe('ensurePaymentLink', () => {
  it('does nothing for a Pix charge', async () => {
    const { db } = dbWith({ ...infinitePay, payment_snapshot: { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'a@b.c', label: 'Pix' } });
    const links = provider({ status: 'created', url: 'x' });

    expect(await ensurePaymentLink(db, links, config, 'c1')).toBeNull();
    expect(links.createLink).not.toHaveBeenCalled();
  });

  it('creates the link once with the charge as order and the webhook/redirect urls', async () => {
    const { db, updates, events } = dbWith(infinitePay);
    const links = provider({ status: 'created', url: 'https://checkout/abc' });

    expect(await ensurePaymentLink(db, links, config, 'c1', Date.UTC(2026, 8, 18))).toBe(PaymentLinkState.Ready);

    const input = links.createLink.mock.calls[0]![0] as { identity: string; orderNsu: string; amountCents: number; description: string; expiresAt: string; webhookUrl: string; redirectUrl: string };

    expect(input.identity).toBe('loja');
    expect(input.orderNsu).toBe('c1');
    expect(input.amountCents).toBe(1250);
    expect(input.description).toBe('Aluguel');
    expect(input.expiresAt).toBe('2036-01-01T00:00:00.000Z');
    expect(input.webhookUrl).toMatch(/^https:\/\/api\.example\/receivy\/webhooks\/infinitepay\/c1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(input.redirectUrl).toMatch(/^https:\/\/web\.example\/pay\/pub\.\d+\.[A-Za-z0-9_-]+$/);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Ready, payment_link_url: 'https://checkout/abc' });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.created', eventable_id: 'c1' });
  });

  it('is idempotent once the link is ready', async () => {
    const { db } = dbWith({ ...infinitePay, payment_link_state: PaymentLinkState.Ready, payment_link_url: 'https://checkout/abc' });
    const links = provider({ status: 'created', url: 'y' });

    expect(await ensurePaymentLink(db, links, config, 'c1')).toBe(PaymentLinkState.Ready);
    expect(links.createLink).not.toHaveBeenCalled();
  });

  it('records a failure and pushes the owner when the checkout is off', async () => {
    const { db, updates, events } = dbWith(infinitePay);
    const push = vi.fn(async () => ({ status: 'accepted' as const, id: 't' }));
    const transport = { push, email: vi.fn(), receipt: vi.fn() };
    const dbWithDevices = Object.assign(db, { device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd', token: 'ExpoPushToken[x]' }] })) } });

    expect(await ensurePaymentLink(dbWithDevices, provider({ status: 'checkout_disabled', redirectUrl: 'https://app/x' }), config, 'c1', undefined, transport as never)).toBe(PaymentLinkState.Failed);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Failed });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.failed', payload: { reason: 'checkout_disabled', redirectUrl: 'https://app/x' } });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('records another failure but does not re-push an owner already told once', async () => {
    const { db, updates, events } = dbWith({ ...infinitePay, payment_link_state: PaymentLinkState.Failed });
    const push = vi.fn(async () => ({ status: 'accepted' as const, id: 't' }));
    const transport = { push, email: vi.fn(), receipt: vi.fn() };
    const dbWithDevices = Object.assign(db, { device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd', token: 'ExpoPushToken[x]' }] })) } });

    expect(await ensurePaymentLink(dbWithDevices, provider({ status: 'checkout_disabled', redirectUrl: 'https://app/x' }), config, 'c1', undefined, transport as never)).toBe(PaymentLinkState.Failed);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Failed });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.failed', payload: { reason: 'checkout_disabled', redirectUrl: 'https://app/x' } });
    expect(push).not.toHaveBeenCalled();
  });

  it('records unavailable without pushing anyone', async () => {
    const { db, events } = dbWith(infinitePay);

    expect(await ensurePaymentLink(db, provider({ status: 'unavailable' }), config, 'c1')).toBe(PaymentLinkState.Failed);
    expect(events[0]).toMatchObject({ payload: { reason: 'unavailable' } });
  });

  it('records unavailable, never throws, when the webhook token cannot be minted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { db, updates, events } = dbWith(infinitePay);
    const links = provider({ status: 'created', url: 'https://checkout/abc' });
    const brokenConfig: PaymentLinkConfig = { ...config, secret: '' };

    expect(await ensurePaymentLink(db, links, brokenConfig, 'c1')).toBe(PaymentLinkState.Failed);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Failed });
    expect(events[0]).toMatchObject({ payload: { reason: 'unavailable' } });
    expect(links.createLink).not.toHaveBeenCalled();
  });
});

describe('ensurePaymentLink (PagBank)', () => {
  it('decrypts the PagBank token for the call and stores the checkout id', async () => {
    const { db, updates } = dbWith(pagSeguro);
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const links = provider({ status: 'created', url: 'https://checkout/pb', linkId: 'CHEC_1' });

    expect(await ensurePaymentLink(dbFull, links, config, 'c1', Date.UTC(2026, 8, 18))).toBe(PaymentLinkState.Ready);

    const input = links.createLink.mock.calls[0]![0] as { credential: string; identity: string; expiresAt: string; redirectUrl: string };

    expect(input.credential).toBe('tok');
    expect(input.identity).toBe('Loja');
    expect(input.expiresAt).toBe('2036-01-01T00:00:00.000Z');
    expect(input.redirectUrl).toMatch(/\?returned=1$/);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Ready, provider_link_id: 'CHEC_1' });
  });

  it('fails without an external call when the integration is revoked', async () => {
    const { db, updates, events } = dbWith(pagSeguro);
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) }, revoked_at: '2026-01-01T00:00:00.000Z' });
    const links = provider({ status: 'created', url: 'x' });

    expect(await ensurePaymentLink(dbFull, links, config, 'c1')).toBe(PaymentLinkState.Failed);
    expect(updates[0]).toMatchObject({ payment_link_state: PaymentLinkState.Failed });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.failed', payload: { reason: 'no_credential', detail: 'revoked' } });
    expect(links.createLink).not.toHaveBeenCalled();
  });

  it('marks unauthorized and pushes the owner once', async () => {
    const { db, events } = dbWith(pagSeguro);
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const push = vi.fn(async (_input: { token: string; title: string; body: string; url: string }) => ({ status: 'accepted' as const, id: 't' }));
    const transport = { push, email: vi.fn(), receipt: vi.fn() };
    const dbWithDevices = Object.assign(dbFull, { device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd', token: 'ExpoPushToken[x]' }] })) } });

    expect(await ensurePaymentLink(dbWithDevices, provider({ status: 'unauthorized' }), config, 'c1', undefined, transport as never)).toBe(PaymentLinkState.Failed);
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.failed', payload: { reason: 'unauthorized' } });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatchObject({ title: 'Token do PagBank inválido' });
  });

  it('does not re-push an owner already told once', async () => {
    const { db } = dbWith({ ...pagSeguro, payment_link_state: PaymentLinkState.Failed });
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const push = vi.fn(async () => ({ status: 'accepted' as const, id: 't' }));
    const transport = { push, email: vi.fn(), receipt: vi.fn() };
    const dbWithDevices = Object.assign(dbFull, { device_tokens: { findMany: vi.fn(async () => ({ records: [] })) } });

    expect(await ensurePaymentLink(dbWithDevices, provider({ status: 'unauthorized' }), config, 'c1', undefined, transport as never)).toBe(PaymentLinkState.Failed);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('inactivatePaymentLink', () => {
  it('inactivates a cancelled PagBank checkout', async () => {
    const { db, events } = dbWith({ ...pagSeguro, payment_link_state: PaymentLinkState.Ready, provider_link_id: 'CHEC_1' });
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const client = { createLink: vi.fn(), checkPayment: vi.fn(), inactivate: vi.fn(async () => ({ status: 'done' as const })), verifyCredential: vi.fn() };
    const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

    await inactivatePaymentLink(dbFull, clients, config, 'c1');

    expect(client.inactivate).toHaveBeenCalledWith({ credential: 'tok', linkId: 'CHEC_1' });
    expect(events[0]).toMatchObject({ type: 'charge.payment_link.inactivated', payload: { linkId: 'CHEC_1' } });
  });

  it('skips a charge that is not an open PagBank checkout', async () => {
    const { db, events } = dbWith({ ...pagSeguro, payment_link_state: PaymentLinkState.Failed, provider_link_id: 'CHEC_1' });
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const client = { createLink: vi.fn(), checkPayment: vi.fn(), inactivate: vi.fn(async () => ({ status: 'done' as const })), verifyCredential: vi.fn() };
    const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

    await inactivatePaymentLink(dbFull, clients, config, 'c1');

    expect(client.inactivate).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('records inactivate_failed when the provider refuses', async () => {
    const { db, events } = dbWith({ ...pagSeguro, payment_link_state: PaymentLinkState.Ready, provider_link_id: 'CHEC_1' });
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const client = { createLink: vi.fn(), checkPayment: vi.fn(), inactivate: vi.fn(async () => ({ status: 'unauthorized' as const })), verifyCredential: vi.fn() };
    const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

    await inactivatePaymentLink(dbFull, clients, config, 'c1');

    expect(events[0]).toMatchObject({ type: 'charge.payment_link.inactivate_failed', payload: { linkId: 'CHEC_1', reason: 'unauthorized' } });
  });

  it('stays silent when the provider does not support inactivation', async () => {
    const { db, events } = dbWith({ ...pagSeguro, payment_link_state: PaymentLinkState.Ready, provider_link_id: 'CHEC_1' });
    const dbFull = withIntegration(db, { id: 'int-1', credentials: { ciphertext: seal('tok', CREDENTIAL_KEY) } });
    const client = { createLink: vi.fn(), checkPayment: vi.fn(), inactivate: vi.fn(async () => ({ status: 'unsupported' as const })), verifyCredential: vi.fn() };
    const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

    await inactivatePaymentLink(dbFull, clients, config, 'c1');

    expect(events).toHaveLength(0);
  });

  it('still asks InfinitePay to inactivate without an integrationId, and stays silent on unsupported', async () => {
    const { db, events } = dbWith({ ...infinitePay, payment_link_state: PaymentLinkState.Ready, provider_link_id: 'LINK_1' });
    const client = { createLink: vi.fn(), checkPayment: vi.fn(), inactivate: vi.fn(async () => ({ status: 'unsupported' as const })), verifyCredential: vi.fn() };
    const clients = { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;

    await inactivatePaymentLink(db, clients, config, 'c1');

    expect(client.inactivate).toHaveBeenCalledWith({ credential: undefined, linkId: 'LINK_1' });
    expect(events).toHaveLength(0);
  });
});

const link = { orderNsu: 'c1', amountCents: 100, description: 'x', expiresAt: '2036-01-01T00:00:00.000Z', identity: 'loja' };

describe('checkoutClients', () => {
  it('talks to InfinitePay over the network when PAYMENT_METHOD_LINK=live', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout/abc' }), { status: 200 }));

    const clients = checkoutClients({ PAYMENT_METHOD_LINK: 'live' }, request as unknown as typeof fetch);

    expect(await clients[PaymentProvider.InfinitePay].createLink(link)).toEqual({ status: 'created', url: 'https://checkout/abc' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('puts PagBank on its sandbox host when PAYMENT_METHOD_LINK=sandbox', async () => {
    const request = vi.fn(async () => new Response('{}', { status: 404 }));

    const clients = checkoutClients({ PAYMENT_METHOD_LINK: 'sandbox' }, request as unknown as typeof fetch);

    expect(await clients[PaymentProvider.PagSeguro].verifyCredential('token')).toEqual({ status: 'valid' });
    expect((request.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/sandbox\.api\.pagseguro\.com\//);
  });

  it('returns the in-process fake for both providers when PAYMENT_METHOD_LINK=fake', async () => {
    const request = vi.fn();

    const clients = checkoutClients({ PAYMENT_METHOD_LINK: 'fake', PUBLIC_WEB_ORIGIN: 'https://w' }, request as unknown as typeof fetch);
    const infinitePay = await clients[PaymentProvider.InfinitePay].createLink({ ...link, orderNsu: 'c2' });
    const pagSeguro = await clients[PaymentProvider.PagSeguro].createLink({ ...link, orderNsu: 'c2-pb' });

    expect(infinitePay.status === 'created' && infinitePay.url.startsWith('https://w/dev/checkout/infinitepay/')).toBe(true);
    expect(pagSeguro.status === 'created' && pagSeguro.url.startsWith('https://w/dev/checkout/pagseguro/')).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('is unavailable on both providers when PAYMENT_METHOD_LINK is unset', async () => {
    const request = vi.fn();

    const clients = checkoutClients({}, request as unknown as typeof fetch);

    expect(await clients[PaymentProvider.InfinitePay].createLink({ ...link, orderNsu: 'c3' })).toEqual({ status: 'unavailable' });
    expect(await clients[PaymentProvider.PagSeguro].createLink({ ...link, orderNsu: 'c3' })).toEqual({ status: 'unavailable' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('webhookToken', () => {
  it('names the charge and lives ten years', () => {
    const token = webhookToken('c1', config.secret, 1_000);

    expect(token.startsWith('c1.315361000.')).toBe(true);
  });
});
