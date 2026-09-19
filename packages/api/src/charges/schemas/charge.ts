import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { ChargeState, PaymentLinkState, PaymentProvider, PixKeyType, ProofMime } from '@receivy/common';

export const enum StoredProofState {
  Uploading = 'uploading',
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected'
}

/** The four names the `payment_methods` row carries; `kind` only on Pix. */
export interface PaymentSnapshotSchema {
  provider: PaymentProvider;
  kind?: PixKeyType;
  value: String.Max<254>;
  label: String.Max<120>;
}

export interface ProofFileSchema {
  key: String.Max<300>;
  name: String.Max<200>;
  mime: ProofMime;
  size: number;
  sha256?: String.Max<64>;
}

export interface ChargeSchema extends Database.Schema {
  id: String.UUID;
  /** The billing owner, whichever side of the money they are on: every owner power keys on this. */
  owner_id: String.UUID;
  /** Who receives (users.id); null on a conta a pagar without a payee. Name and e-mail are read live. */
  creditor_id?: String.UUID;
  /** Who pays (users.id); null on a registro with nobody on the other side. */
  debtor_id?: String.UUID;
  billing_id: String.UUID;
  description: String.Max<500>;
  amount_cents: number;
  due_date: String.Date;
  installment?: number;
  installment_count?: number;
  /** Frozen copy of how this charge is paid; never queried by content, so one object beats three columns. */
  payment_snapshot?: PaymentSnapshotSchema;
  /** InfinitePay checkout link of this charge; null on a charge paid through a Pix key. The real link carries a ~600-char `lenc` blob. */
  payment_link_url?: String.Max<2048>;
  payment_link_state?: PaymentLinkState;
  /** `transaction_nsu` of the payment the provider confirmed: the idempotency key of the settlement. */
  provider_transaction_id?: String.Max<120>;
  provider_receipt_url?: String.Max<2048>;
  state: ChargeState;
  cancelled_at?: String.DateTime;
  paid_at?: String.DateTime;
  /** Automatic notices: the only value the notice gate reads. Defaults to true in the database. */
  notify: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
