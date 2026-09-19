import { PLAN_LIMITS, type PlanLimits, type PlanTier, planOf } from '@receivy/common';
import { BillingRepository } from '../../billings/repositories/billing';
import type { DbClient } from '../../database';
import { PlanLimitReachedError, PlanRequiredError } from '../errors';
import { SubscriptionRepository } from '../repositories/subscription';

export async function planOfOwner(db: DbClient, ownerId: string, now: Date): Promise<PlanTier> {
  return planOf(SubscriptionRepository.snapshotOf(await SubscriptionRepository.get(db, ownerId)), now);
}

export async function limitsOf(db: DbClient, ownerId: string, now: Date): Promise<{ plan: PlanTier; limits: PlanLimits; used: number }> {
  const plan = await planOfOwner(db, ownerId, now);
  const used = await BillingRepository.countActiveIndefinite(db, ownerId);

  return { plan, limits: PLAN_LIMITS[plan], used };
}

/** Call inside the owner's transaction, after `AccountRepository.lock`: the count and the insert share the lock. */
export async function assertCanCreateIndefinite(db: DbClient, ownerId: string, now: Date): Promise<void> {
  const { plan, limits, used } = await limitsOf(db, ownerId, now);

  if (used + 1 > limits.indefinite) {
    throw new PlanLimitReachedError(limits.indefinite, used, plan);
  }
}

export async function assertCheckoutLinksAllowed(db: DbClient, ownerId: string, now: Date): Promise<void> {
  const plan = await planOfOwner(db, ownerId, now);

  if (!PLAN_LIMITS[plan].checkoutLinks) {
    throw new PlanRequiredError();
  }
}
