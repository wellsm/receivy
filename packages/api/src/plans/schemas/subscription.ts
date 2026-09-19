import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { PlanTier, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';

/** One paid subscription per owner; the plan in force is derived from `status` + `current_period_end`, never stored. */
export interface SubscriptionSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  provider: SubscriptionProvider;
  stripe_customer_id: String.Max<64>;
  /** Null after a cancel until the owner subscribes again. */
  stripe_subscription_id?: String.Max<64>;
  plan: PlanTier;
  status: SubscriptionStatus;
  current_period_end?: String.DateTime;
  cancel_at_period_end: boolean;
  /** Webhook idempotency: the last Stripe event applied, and when Stripe created it. */
  last_event_id?: String.Max<64>;
  last_event_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
