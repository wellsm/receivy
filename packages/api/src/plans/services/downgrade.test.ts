import { BillingKind } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { applyDowngrade } from './downgrade';

function dbWith(indefinite: Array<{ id: string; created_at: string }>, linked: string[], checkoutMethods: string[]) {
  const updated: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const wheres: Array<Record<string, unknown>> = [];
  const db = {
    billings: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);

        return { records: 'payment_method_id' in where ? linked.map((id) => ({ id })) : indefinite };
      }),
      updateOne: vi.fn(async ({ where }: { where: { id: string } }) => {
        updated.push(where.id);

        return { id: where.id };
      })
    },
    payment_methods: { findMany: vi.fn(async () => ({ records: checkoutMethods.map((id) => ({ id })) })) },
    events: {
      insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);

        return { id: 'e' };
      })
    },
    users: { findOne: vi.fn(async () => ({ id: 'o1' })) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };

  return { db: db as never, updated, events, wheres };
}

describe('applyDowngrade', () => {
  it('pauses the newest indefinites above the free ceiling and every billing on a checkout method, once each', async () => {
    const { db, updated, events } = dbWith(
      [{ id: 'b7', created_at: '2026-07' }, { id: 'b6', created_at: '2026-06' }, { id: 'b5', created_at: '2026-05' }, { id: 'b4', created_at: '2026-04' }, { id: 'b3', created_at: '2026-03' }, { id: 'b2', created_at: '2026-02' }, { id: 'b1', created_at: '2026-01' }],
      ['b2', 'b9'],
      ['pm-link']
    );
    const result = await applyDowngrade(db, 'o1', new Date('2026-09-19T12:00:00Z'));

    expect(result.pausedIds).toEqual(['b7', 'b6', 'b2', 'b9']);
    expect(updated).toEqual(['b7', 'b6', 'b2', 'b9']);
    expect(events.map((event) => [event.eventable_id, event.type, event.payload])).toEqual([
      ['b7', 'billing.paused', { reason: 'plan' }], ['b6', 'billing.paused', { reason: 'plan' }], ['b2', 'billing.paused', { reason: 'plan' }], ['b9', 'billing.paused', { reason: 'plan' }]
    ]);
  });

  it('does nothing under the ceiling with no checkout methods', async () => {
    const { db, updated } = dbWith([{ id: 'b1', created_at: '2026-01' }], [], []);

    expect(await applyDowngrade(db, 'o1', new Date())).toEqual({ pausedIds: [] });
    expect(updated).toEqual([]);
  });

  it('skips the payment-method query when the owner has no checkout method', async () => {
    const { db } = dbWith([], [], []);

    await applyDowngrade(db, 'o1', new Date());

    expect((db as never as { billings: { findMany: ReturnType<typeof vi.fn> } }).billings.findMany).toHaveBeenCalledTimes(1);
  });

  it('filters the linked-billings query to live billings, never a registro', async () => {
    const { wheres, db } = dbWith([], ['b2'], ['pm-link']);

    await applyDowngrade(db, 'o1', new Date());

    const linkedWhere = wheres.find((where) => 'payment_method_id' in where);

    expect(linkedWhere).toMatchObject({ kind: BillingKind.Live });
  });
});
