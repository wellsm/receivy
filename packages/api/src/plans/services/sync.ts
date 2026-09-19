import { PlanTier, SubscriptionStatus, planOf } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { AccountRepository } from '../../users/repositories/account';
import type { StripeClient } from '../../vendors/stripe/types';
import { SubscriptionRepository } from '../repositories/subscription';
import { applyDowngrade } from './downgrade';
import { PlanNoticeKind, type PlanNotices, notifyPlan } from './notices';

export type { PlanNotices } from './notices';

export type SyncEvent = { id: string; created: string; type: string };

export type SyncOutcome = 'applied' | 'replayed' | 'unavailable' | 'ignored';

/**
 * The single writer of `subscriptions` after the first insert: re-reads the subscription at Stripe (the event
 * payload is never trusted), stores what it finds, and acts on the transition it observes. Notices go out after
 * the transaction commits.
 */
export async function syncSubscription(db: DbClient, stripe: StripeClient, notices: PlanNotices, row: SubscriptionRepository.Row, now: Date, event?: SyncEvent): Promise<SyncOutcome> {
  if (event && row.last_event_id === event.id) {
    return 'replayed';
  }

  if (!row.stripe_subscription_id) {
    return 'ignored';
  }

  const remote = await stripe.getSubscription(row.stripe_subscription_id);

  if (remote.status === 'unavailable') {
    return 'unavailable';
  }

  const state = remote.status === 'ok' ? remote.subscription : { status: SubscriptionStatus.Canceled, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  const after = planOf({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, now);
  const stamp = now.toISOString();
  const result = await db.transaction(async (tx): Promise<{ outcome: SyncOutcome; notice: { kind: PlanNoticeKind; paused: number } | null }> => {
    await AccountRepository.lock(tx, row.owner_id);

    const locked = (await SubscriptionRepository.get(tx, row.owner_id, true)) ?? row;

    if (event && locked.last_event_id === event.id) {
      return { outcome: 'replayed', notice: null };
    }

    const before = planOf(SubscriptionRepository.snapshotOf(locked), now);
    const newer = !event || !locked.last_event_at || event.created >= locked.last_event_at;

    await SubscriptionRepository.applyState(tx, locked.id, { status: state.status, currentPeriodEnd: state.currentPeriodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd, eventId: newer && event ? event.id : null, eventAt: newer && event ? event.created : null, now: stamp });

    if (before === PlanTier.Free && after === PlanTier.Basic) {
      await EventRepository.record(tx, { type: 'plan.subscribed', eventableType: EventableType.Account, eventableId: row.owner_id, payload: { subscriptionId: row.stripe_subscription_id }, at: stamp });

      return { outcome: 'applied', notice: { kind: PlanNoticeKind.Subscribed, paused: 0 } };
    }

    if (before === PlanTier.Basic && after === PlanTier.Free) {
      const { pausedIds } = await applyDowngrade(tx, row.owner_id, now);

      await EventRepository.record(tx, { type: 'plan.canceled', eventableType: EventableType.Account, eventableId: row.owner_id, payload: { subscriptionId: row.stripe_subscription_id, pausedIds }, at: stamp });

      return { outcome: 'applied', notice: { kind: PlanNoticeKind.Canceled, paused: pausedIds.length } };
    }

    if (event?.type === 'invoice.payment_failed' && state.status === SubscriptionStatus.PastDue) {
      await EventRepository.record(tx, { type: 'plan.payment_failed', eventableType: EventableType.Account, eventableId: row.owner_id, payload: { subscriptionId: row.stripe_subscription_id }, at: stamp });

      return { outcome: 'applied', notice: { kind: PlanNoticeKind.PaymentFailed, paused: 0 } };
    }

    return { outcome: 'applied', notice: null };
  });

  if (result.notice) {
    try {
      await notifyPlan(db, notices, row.owner_id, result.notice.kind, result.notice.paused, event?.id ?? stamp);
    } catch {
      console.warn('Plan notice failed', { ownerId: row.owner_id, kind: result.notice.kind });
    }
  }

  return result.outcome;
}
