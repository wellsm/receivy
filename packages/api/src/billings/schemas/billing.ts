import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type {
  BillingCategory,
  BillingDueRule,
  BillingFrequency,
  BillingKind,
  BillingState,
  BillingType,
  Direction,
  PixKeyType,
  SplitMode
} from '@receivy/common';

export interface BillingSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  /** How the billing repeats. */
  recurrence: BillingType;
  /** A live billing or a registro. */
  kind: BillingKind;
  frequency?: BillingFrequency;
  description: String.Max<500>;
  category: BillingCategory;
  total_cents: number;
  start_date: String.Date;
  end_date?: String.Date;
  /** 'end_of_month' lands every occurrence on the last day of its month. Defaults to 'fixed' in the database. */
  due_rule: BillingDueRule;
  payment_method_id?: String.UUID;
  /** @deprecated Became `type`; still written until the block 8 backfill runs, then dropped. */
  direction: Direction;
  /** 'payable' is the owner's own bill; 'receivable' means the owner collects from contacts. Null only until the backfill runs. */
  type?: Direction;
  /** Conta a pagar only: the key typed on the billing (it belongs to whoever receives, not to a wallet). */
  pix_key_type?: PixKeyType;
  pix_key?: String.Max<254>;
  pix_label?: String.Max<120>;
  /** Registro only: who the money came from or went to, typed by the owner. */
  counterpart_label?: String.Max<120>;
  /** JSON array of { offsetDays, enabled }; null falls back to the owner's notification preferences. */
  reminders?: String.Max<2000>;
  state: BillingState;
  /** The one split mode of the billing; every allocation used to carry its own copy. */
  split_mode?: SplitMode;
  /** Recorrente only: the last occurrence already materialized; null before the first one. */
  last_occurrence_date?: String.Date;
  idempotency_key: String.Max<200>;
  request_hash: String.Max<64>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}

export interface AllocationSchema extends Database.Schema {
  id: String.UUID;
  billing_id: String.UUID;
  /** The participant (users.id); the owner's own part carries the billing owner. */
  user_id: String.UUID;
  /** Raw split value: cents on `fixed`, basis points on `percentage`, the quota on `shares`, unused on `equal`. */
  value?: number;
  /** Position of the part inside the split. */
  sort_order: number;
  /** Automatic notices of a 'user' part: new charges of this participant copy it. Defaults to true in the database. */
  notify: boolean;
  created_at: String.DateTime;
}
