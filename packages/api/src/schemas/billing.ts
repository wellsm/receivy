import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface BillingSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  type: 'once' | 'until' | 'indefinite';
  frequency?: 'monthly' | 'yearly';
  description: String.Max<500>;
  category: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
  total_cents: number;
  currency: 'BRL';
  start_date: String.Date;
  end_date?: String.Date;
  timezone: String.Max<100>;
  payment_method_id?: String.UUID;
  /** JSON array of { offsetDays, enabled }; null falls back to the owner's notification preferences. */
  reminders?: String.Max<2000>;
  state: 'active' | 'paused' | 'ended';
  processed_through?: String.Date;
  idempotency_key: String.Max<200>;
  request_hash: String.Max<64>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}

export interface AllocationSchema extends Database.Schema {
  id: String.UUID;
  billing_id: String.UUID;
  person_id?: String.UUID;
  kind: 'owner' | 'person';
  split_mode: 'fixed' | 'equal' | 'percentage' | 'shares';
  basis_points?: number;
  /** Quota weight for `shares` splits; null for every other mode. */
  shares?: number;
  amount_cents: number;
  allocation_order: number;
  created_at: String.DateTime;
}
