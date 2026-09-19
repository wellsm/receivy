import { PlanTier, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionRepository } from './subscription';

function dbWith(row: Partial<SubscriptionRepository.Row> | null) {
  return {
    subscriptions: {
      findOne: vi.fn(async () => row),
      insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, owner_id: (data.owner as { id: string }).id })),
      updateOne: vi.fn(async () => ({ id: 'sub-row' }))
    }
  } as never;
}

describe('SubscriptionRepository', () => {
  it('inserts an incomplete basic row bound to the owner and customer', async () => {
    const db = dbWith(null);
    const row = await SubscriptionRepository.insert(db, { ownerId: 'o1', customerId: 'cus_1', now: '2026-09-19T00:00:00.000Z' });

    expect(row).toMatchObject({ owner_id: 'o1', provider: SubscriptionProvider.Stripe, stripe_customer_id: 'cus_1', plan: PlanTier.Basic, status: SubscriptionStatus.Incomplete, cancel_at_period_end: false });
  });

  it('applies the provider state and the event watermark in one update', async () => {
    const db = dbWith(null);

    await SubscriptionRepository.applyState(db, 'row-1', { status: SubscriptionStatus.Active, currentPeriodEnd: '2026-10-19T00:00:00.000Z', cancelAtPeriodEnd: false, eventId: 'evt_1', eventAt: '2026-09-19T00:00:01.000Z', now: '2026-09-19T00:00:02.000Z' });

    expect((db as never as { subscriptions: { updateOne: ReturnType<typeof vi.fn> } }).subscriptions.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'row-1' }, data: expect.objectContaining({ status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z', last_event_id: 'evt_1' }) })
    );
  });

  it('clears the period end and skips the watermark when the event carries neither id nor date', async () => {
    const db = dbWith(null);

    await SubscriptionRepository.applyState(db, 'row-1', { status: SubscriptionStatus.Active, currentPeriodEnd: null, cancelAtPeriodEnd: true, eventId: null, eventAt: null, now: '2026-09-19T00:00:02.000Z' });

    const { data } = (db as never as { subscriptions: { updateOne: ReturnType<typeof vi.fn> } }).subscriptions.updateOne.mock.calls[0]![0] as { data: Record<string, unknown> };

    expect(data).toMatchObject({ status: SubscriptionStatus.Active, current_period_end: null, cancel_at_period_end: true, updated_at: '2026-09-19T00:00:02.000Z' });
    expect(data).not.toHaveProperty('last_event_id');
    expect(data).not.toHaveProperty('last_event_at');
  });

  it('maps a row to the snapshot planOf reads', () => {
    expect(SubscriptionRepository.snapshotOf({ status: SubscriptionStatus.PastDue, current_period_end: '2026-10-01T00:00:00.000Z' } as SubscriptionRepository.Row)).toEqual({ status: SubscriptionStatus.PastDue, currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
    expect(SubscriptionRepository.snapshotOf(null)).toBeNull();
  });
});
