import { PlanTier, type SubscriptionSnapshot, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';
import type { DbClient } from '../../database';

const sqlNull = null as unknown as undefined;

export namespace SubscriptionRepository {
  export type Row = {
    id: string;
    owner_id: string;
    provider: SubscriptionProvider;
    stripe_customer_id: string;
    stripe_subscription_id?: string;
    plan: PlanTier;
    status: SubscriptionStatus;
    current_period_end?: string;
    cancel_at_period_end: boolean;
    last_event_id?: string;
    last_event_at?: string;
    created_at: string;
    updated_at: string;
  };

  export async function get(db: DbClient, ownerId: string, lock = false): Promise<Row | null> {
    const row = await db.subscriptions.findOne({
      select: { id: true, owner_id: true, provider: true, stripe_customer_id: true, stripe_subscription_id: true, plan: true, status: true, current_period_end: true, cancel_at_period_end: true, last_event_id: true, last_event_at: true, created_at: true, updated_at: true },
      where: { owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  export async function bySubscriptionId(db: DbClient, stripeSubscriptionId: string, lock = false): Promise<Row | null> {
    // `stripe_subscription_id` is a secondary index, so findOne (which wants a primary or unique one) cannot be used here.
    const { records } = await db.subscriptions.findMany({
      select: { id: true, owner_id: true, provider: true, stripe_customer_id: true, stripe_subscription_id: true, plan: true, status: true, current_period_end: true, cancel_at_period_end: true, last_event_id: true, last_event_at: true, created_at: true, updated_at: true },
      where: { stripe_subscription_id: stripeSubscriptionId },
      ...(lock ? { lock: true } : {})
    });

    return records[0] ?? null;
  }

  /** First contact with Stripe: the customer exists, the subscription does not yet. */
  export async function insert(db: DbClient, input: { ownerId: string; customerId: string; now: string }): Promise<Row> {
    return db.subscriptions.insertOne({
      select: { id: true, owner_id: true, provider: true, stripe_customer_id: true, stripe_subscription_id: true, plan: true, status: true, current_period_end: true, cancel_at_period_end: true, last_event_id: true, last_event_at: true, created_at: true, updated_at: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        provider: SubscriptionProvider.Stripe,
        stripe_customer_id: input.customerId,
        plan: PlanTier.Basic,
        status: SubscriptionStatus.Incomplete,
        cancel_at_period_end: false,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  /** A new Stripe subscription replaces whatever the row pointed at (a canceled one, or nothing). */
  export async function setSubscription(db: DbClient, id: string, input: { stripeSubscriptionId: string | null; status: SubscriptionStatus; now: string }): Promise<void> {
    await db.subscriptions.updateOne({
      select: { id: true },
      where: { id },
      data: { stripe_subscription_id: input.stripeSubscriptionId ?? sqlNull, status: input.status, current_period_end: sqlNull, cancel_at_period_end: false, last_event_id: sqlNull, last_event_at: sqlNull, updated_at: input.now }
    });
  }

  export async function applyState(db: DbClient, id: string, input: { status: SubscriptionStatus; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; eventId: string | null; eventAt: string | null; now: string }): Promise<void> {
    await db.subscriptions.updateOne({
      select: { id: true },
      where: { id },
      data: {
        status: input.status,
        current_period_end: input.currentPeriodEnd ?? sqlNull,
        cancel_at_period_end: input.cancelAtPeriodEnd,
        ...(input.eventId ? { last_event_id: input.eventId } : {}),
        ...(input.eventAt ? { last_event_at: input.eventAt } : {}),
        updated_at: input.now
      }
    });
  }

  export function snapshotOf(row: Row | null): SubscriptionSnapshot | null {
    return row ? { status: row.status, currentPeriodEnd: row.current_period_end ?? null } : null;
  }
}
