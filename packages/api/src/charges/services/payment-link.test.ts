import { ChargeState, PaymentLinkState, PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { ensurePaymentLink, type PaymentLinkConfig, paymentLinkProvider, webhookToken } from './payment-link';

const config: PaymentLinkConfig = { apiOrigin: 'https://api.example/receivy', webOrigin: 'https://web.example', secret: 'test-payment-link-secret-with-entropy' };

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

function provider(result: Awaited<ReturnType<PaymentLinkProvider['createLink']>>) {
  return { createLink: vi.fn(async () => result), checkPayment: vi.fn() } as unknown as PaymentLinkProvider & { createLink: ReturnType<typeof vi.fn> };
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

    const input = links.createLink.mock.calls[0]![0] as { handle: string; orderNsu: string; items: unknown[]; webhookUrl: string; redirectUrl: string };

    expect(input.handle).toBe('loja');
    expect(input.orderNsu).toBe('c1');
    expect(input.items).toEqual([{ quantity: 1, price: 1250, description: 'Aluguel' }]);
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

describe('paymentLinkProvider', () => {
  it('talks to InfinitePay over the network when PAYMENT_METHOD_LINK=live', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout/abc' }), { status: 200 }));

    const links = paymentLinkProvider({ PAYMENT_METHOD_LINK: 'live' }, request as unknown as typeof fetch);

    expect(await links.createLink({ handle: 'loja', orderNsu: 'c1', items: [{ quantity: 1, price: 100, description: 'x' }] })).toEqual({ status: 'created', url: 'https://checkout/abc' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('returns the in-process fake when PAYMENT_METHOD_LINK=fake', async () => {
    const request = vi.fn();

    const links = paymentLinkProvider({ PAYMENT_METHOD_LINK: 'fake', PUBLIC_WEB_ORIGIN: 'https://w' }, request as unknown as typeof fetch);
    const result = await links.createLink({ handle: 'loja', orderNsu: 'c2', items: [{ quantity: 1, price: 100, description: 'x' }] });

    expect(result.status).toBe('created');
    expect(result.status === 'created' && result.url.startsWith('https://w/dev/infinitepay/')).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('is unavailable when PAYMENT_METHOD_LINK is unset', async () => {
    const request = vi.fn();

    const links = paymentLinkProvider({}, request as unknown as typeof fetch);

    expect(await links.createLink({ handle: 'loja', orderNsu: 'c3', items: [{ quantity: 1, price: 100, description: 'x' }] })).toEqual({ status: 'unavailable' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('webhookToken', () => {
  it('names the charge and lives ten years', () => {
    const token = webhookToken('c1', config.secret, 1_000);

    expect(token.startsWith('c1.315361000.')).toBe(true);
  });
});
