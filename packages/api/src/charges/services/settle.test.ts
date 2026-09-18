import { ChargeState, PaymentProvider } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { settleByProvider } from './settle';

const base = {
  id: 'c1',
  amount_cents: 1000,
  description: 'Aluguel',
  state: ChargeState.Pending,
  owner_id: 'owner',
  creditor_id: 'owner',
  debtor_id: 'payer',
  payment_snapshot: { provider: PaymentProvider.InfinitePay, value: 'loja', label: 'InfinitePay' }
};

function dbWith(charge: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const db = {
    transaction: async (fn: (tx: DbClient) => Promise<unknown>) => fn(db),
    charges: {
      findOne: vi.fn(async () => charge),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);

        return charge;
      })
    },
    proofs: { findMany: vi.fn(async () => ({ records: [] })) },
    events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => events.push(data)), findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'payer', name: 'Ana Silva' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) }
  } as unknown as DbClient;

  return { db, updates, events };
}

function links(check: Awaited<ReturnType<PaymentLinkProvider['checkPayment']>>) {
  return { createLink: vi.fn(), checkPayment: vi.fn(async () => check) } as unknown as PaymentLinkProvider & { checkPayment: ReturnType<typeof vi.fn> };
}

const notices = { transport: { push: vi.fn(async () => ({ status: 'disabled' as const })), email: vi.fn(), receipt: vi.fn() }, origin: 'https://web' };
const input = { chargeId: 'c1', transactionNsu: 'tx-1', slug: 'inv-1', receiptUrl: 'https://receipt/1' };
const paid = { status: 'checked' as const, paid: true, amountCents: 1000, paidAmountCents: 1010, captureMethod: 'pix' };

describe('settleByProvider', () => {
  it('settles a pending charge after a positive payment_check', async () => {
    const { db, updates, events } = dbWith(base);
    const provider = links(paid);

    expect(await settleByProvider(db, provider, notices as never, input)).toBe('settled');
    expect(provider.checkPayment).toHaveBeenCalledWith({ handle: 'loja', orderNsu: 'c1', transactionNsu: 'tx-1', slug: 'inv-1' });
    expect(updates.at(-1)).toMatchObject({ state: ChargeState.Paid, provider_transaction_id: 'tx-1', provider_receipt_url: 'https://receipt/1' });
    expect(events.at(-1)).toMatchObject({ type: 'charge.paid', payload: { via: 'provider', provider: 'infinitepay', transactionNsu: 'tx-1', paidAmountCents: 1010, captureMethod: 'pix' } });
  });

  it('accepts a pending declaration and tells both sides when the provider settles', async () => {
    const events: Record<string, unknown>[] = [];
    const proof = { id: 'p1', charge_id: 'c1', state: 'pending', kind: 'declaration', file: null, sent_at: '2026-09-01T00:00:00.000Z' };
    const proofUpdates: Record<string, unknown>[] = [];
    const db = {
      transaction: async (fn: (tx: DbClient) => Promise<unknown>) => fn(db),
      charges: {
        findOne: vi.fn(async () => base),
        updateOne: vi.fn(async () => base)
      },
      proofs: {
        findMany: vi.fn(async () => ({ records: [proof] })),
        updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          proofUpdates.push(data);
        })
      },
      events: { insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => events.push(data)), findMany: vi.fn(async () => ({ records: [] })) },
      users: { findOne: vi.fn(async () => ({ id: 'payer', name: 'Ana Silva' })) },
      device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd1', token: 'ExpoPushToken[x]' }] })) }
    } as unknown as DbClient;
    const push = vi.fn(async (_input: { token: string; title: string; body: string; url: string }) => ({ status: 'accepted' as const, id: 't' }));
    const localNotices = { transport: { push, email: vi.fn(), receipt: vi.fn() }, origin: 'https://web' };

    expect(await settleByProvider(db, links(paid), localNotices as never, input)).toBe('settled');
    expect(proofUpdates.at(-1)).toMatchObject({ state: 'accepted' });

    const eventTypes = events.map((event) => event.type);

    expect(eventTypes.indexOf('proof.accepted')).toBeGreaterThanOrEqual(0);
    expect(eventTypes.indexOf('proof.accepted')).toBeLessThan(eventTypes.indexOf('charge.paid'));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls.map((call) => call[0].title)).toEqual(['Pagamento recebido pela InfinitePay', 'Pagamento confirmado']);
  });

  it('drops a receipt url that is not https', async () => {
    const { db, updates } = dbWith(base);

    expect(await settleByProvider(db, links(paid), notices as never, { ...input, receiptUrl: 'http://evil' })).toBe('settled');
    expect(updates.at(-1)).not.toHaveProperty('provider_receipt_url');
  });

  it('replays a transaction already recorded without calling the provider', async () => {
    const { db } = dbWith({ ...base, state: ChargeState.Paid, provider_transaction_id: 'tx-1' });
    const provider = links(paid);

    expect(await settleByProvider(db, provider, notices as never, input)).toBe('replayed');
    expect(provider.checkPayment).not.toHaveBeenCalled();
  });

  it('ignores a Pix charge', async () => {
    const { db } = dbWith({ ...base, payment_snapshot: { provider: PaymentProvider.Pix, kind: 'email', value: 'a@b.c', label: 'Pix' } });
    const provider = links(paid);

    expect(await settleByProvider(db, provider, notices as never, input)).toBe('ignored');
    expect(provider.checkPayment).not.toHaveBeenCalled();
  });

  it('answers unavailable when payment_check cannot be reached', async () => {
    const { db, updates } = dbWith(base);

    expect(await settleByProvider(db, links({ status: 'unavailable' }), notices as never, input)).toBe('unavailable');
    expect(updates).toHaveLength(0);
  });

  it('records a rejected check without settling', async () => {
    const { db, updates, events } = dbWith(base);

    expect(await settleByProvider(db, links({ ...paid, paid: false }), notices as never, input)).toBe('rejected');
    expect(updates).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.rejected' });
  });

  it('records a smaller amount as a mismatch', async () => {
    const { db, updates, events } = dbWith(base);

    expect(await settleByProvider(db, links({ ...paid, amountCents: 900 }), notices as never, input)).toBe('mismatch');
    expect(updates).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.mismatch', payload: { amountCents: 900, transactionNsu: 'tx-1' } });
  });

  it('leaves a cancelled charge alone and writes it down', async () => {
    const { db, updates, events } = dbWith({ ...base, state: ChargeState.Cancelled });

    expect(await settleByProvider(db, links(paid), notices as never, input)).toBe('ignored');
    expect(updates).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'charge.provider.ignored', payload: { state: ChargeState.Cancelled, transactionNsu: 'tx-1' } });
  });
});
