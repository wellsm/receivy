import { BillingState, PLAN_LIMITS, PlanTier } from '@receivy/common';
import { BillingRepository } from '../../billings/repositories/billing';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { PaymentMethodRepository } from '../../payment-methods/repositories/payment-method';

/**
 * Runs once per basic → free transition, never at launch: the newest indefinites above the free ceiling and every
 * billing that can only be paid through a checkout link are paused. Nothing is archived; the owner reactivates.
 */
export async function applyDowngrade(db: DbClient, ownerId: string, now: Date): Promise<{ pausedIds: string[] }> {
  const stamp = now.toISOString();
  const indefinite = await BillingRepository.activeIndefiniteByOwner(db, ownerId);
  const excess = indefinite.slice(0, Math.max(0, indefinite.length - PLAN_LIMITS[PlanTier.Free].indefinite)).map((row) => row.id);
  const methodIds = await PaymentMethodRepository.checkoutMethodIds(db, ownerId);
  const linked = await BillingRepository.activeByPaymentMethods(db, ownerId, methodIds);
  const pausedIds = [...excess, ...linked.filter((id) => !excess.includes(id))];

  for (const id of pausedIds) {
    await BillingRepository.update(db, id, { state: BillingState.Paused }, stamp);
    await EventRepository.record(db, { type: 'billing.paused', eventableType: EventableType.Billing, eventableId: id, actorId: ownerId, payload: { reason: 'plan' }, at: stamp });
  }

  return { pausedIds };
}
