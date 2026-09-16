import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type {
  BillingCategory,
  BillingDueRule,
  BillingFrequency,
  BillingState,
  BillingType,
  Direction,
  PixKeyType,
  SplitMode,
  SplitPartKind
} from '@receivy/common';

export interface BillingSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  type: BillingType;
  frequency?: BillingFrequency;
  description: String.Max<500>;
  category: BillingCategory;
  total_cents: number;
  start_date: String.Date;
  end_date?: String.Date;
  /** 'end_of_month' lands every occurrence on the last day of its month; null (older rows) means 'fixed'. */
  due_rule?: BillingDueRule;
  payment_method_id?: String.UUID;
  /** 'payable' is the owner's own bill; null (legacy) or 'receivable' means the owner collects from contacts. */
  direction?: Direction;
  /** Conta a pagar only: the person who receives (users.id); null when the bill is the owner's alone. */
  payee_user_id?: String.UUID;
  /** Conta a pagar only: the key typed on the billing (it belongs to whoever receives, not to a wallet). */
  pix_key_type?: PixKeyType;
  pix_key?: String.Max<254>;
  pix_label?: String.Max<120>;
  /** Registro only: who the money came from or went to, typed by the owner. */
  counterpart_label?: String.Max<120>;
  /** True only on a registro: every charge settles on its due date and nobody is notified. Null reads as false. */
  settled?: boolean;
  /** JSON array of { offsetDays, enabled }; null falls back to the owner's notification preferences. */
  reminders?: String.Max<2000>;
  state: BillingState;
  /** Recorrente only: the last occurrence already materialized; null before the first one. */
  last_occurrence_date?: String.Date;
  /** @deprecated Renamed to `last_occurrence_date`. Nothing reads it; the declaration goes once the backfill ran, and EZ4 drops the column with it. */
  processed_through?: String.Date;
  idempotency_key: String.Max<200>;
  request_hash: String.Max<64>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}

export interface AllocationSchema extends Database.Schema {
  id: String.UUID;
  billing_id: String.UUID;
  /** The participant (users.id) on a 'user' part; null on the owner part. */
  user_id?: String.UUID;
  kind: SplitPartKind;
  split_mode: SplitMode;
  basis_points?: number;
  /** Quota weight for `shares` splits; null for every other mode. */
  shares?: number;
  amount_cents: number;
  /** Position of the part inside the split. */
  sort_order?: number;
  /**
   * @deprecated Renamed to `sort_order`. It is NOT NULL with no default, so every insert keeps filling it until the
   * backfill ran and the declaration goes; only `sort_order` is ever read.
   */
  allocation_order: number;
  /** Automatic notices of a 'user' part: new charges of this participant copy it. Null (owner part, older rows) reads as true. */
  notify?: boolean;
  /** @deprecated Inverted into `notify`. Nothing reads it; the declaration goes once the backfill ran. */
  silenced?: boolean;
  created_at: String.DateTime;
}
