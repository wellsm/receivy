import type { PlannedCharge } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { monthChanges } from './month-scope';

function planned(userId: string | null, amountCents: number): PlannedCharge {
  return { userId, description: 'Aluguel', amountCents, currency: 'BRL', dueDate: '2026-03-25', installment: null, installmentCount: null };
}

describe('monthChanges', () => {
  it('updates the same person, cancels who left and creates who joined', () => {
    const existing = [
      { id: 'c-ana', debtorUserId: 'ana', dueDate: '2026-03-20' },
      { id: 'c-bruno', debtorUserId: 'bruno', dueDate: '2026-03-20' }
    ];

    const changes = monthChanges(existing, [planned('ana', 6_000), planned('carla', 6_000)]);

    expect(changes.update).toEqual([{ charge: existing[0], planned: planned('ana', 6_000) }]);
    expect(changes.cancel).toEqual([existing[1]]);
    expect(changes.create).toEqual([planned('carla', 6_000)]);
  });

  it('pairs a conta a pagar without payee by the empty debtor', () => {
    const existing = [{ id: 'c-owner', debtorUserId: null, dueDate: '2026-03-20' }];

    expect(monthChanges(existing, [planned(null, 9_000)])).toEqual({
      update: [{ charge: existing[0], planned: planned(null, 9_000) }],
      cancel: [],
      create: []
    });
  });
});
