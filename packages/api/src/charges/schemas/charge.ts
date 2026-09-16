import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { ChargePayer, ChargeState, PixKeyType, ProofKind, ProofMime } from '@receivy/common';

export const enum StoredProofState {
  Uploading = 'uploading',
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected'
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
  /** The billing owner, whichever side of the money they are on. */
  creditor_id: String.UUID;
  /** The person on the other side (users.id); null only on a conta a pagar without a payee. Name and e-mail are read live. */
  debtor_user_id?: String.UUID;
  /** Who pays: null or 'person' (the contact) on a conta a receber, 'owner' on a conta a pagar. */
  payer?: ChargePayer;
  billing_id: String.UUID;
  description: String.Max<500>;
  amount_cents: number;
  due_date: String.Date;
  installment?: number;
  installment_count?: number;
  pix_key_type_snapshot?: PixKeyType;
  pix_key_snapshot?: String.Max<254>;
  pix_label_snapshot?: String.Max<120>;
  state: ChargeState;
  cancelled_at?: String.DateTime;
  paid_at?: String.DateTime;
  /**
   * The single file attached to the charge. `uploading` is a reserved slot waiting for the bucket
   * event; the earlier files' history lives in `events`.
   */
  proof_state?: StoredProofState;
  /** File or declaration; null on rows written before declarations existed reads as a file. */
  proof_kind?: ProofKind;
  proof_file?: ProofFileSchema;
  /** Who sent it: a signed-in debtor, or nobody when it came through the public link. */
  proof_sender_user_id?: String.UUID;
  /** Hash of the sender (user id or public token) so the same actor may replace or withdraw it. */
  proof_actor_hash?: String.Max<64>;
  /** Only while `uploading`: when the reserved slot expires. */
  proof_expires_at?: String.DateTime;
  proof_sent_at?: String.DateTime;
  proof_reviewed_at?: String.DateTime;
  proof_reason?: String.Max<500>;
  /** The public payment link, versioned: rotating bumps the version and kills the previous token. */
  public_id?: String.Max<64>;
  link_version?: number;
  link_expires_at?: String.DateTime;
  link_revoked_at?: String.DateTime;
  /** Automatic notices: the only value the notice gate reads. Null on older rows reads as true. */
  notify?: boolean;
  /** @deprecated Inverted into `notify`. Nothing reads it; the declaration goes once the backfill ran. */
  silenced?: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
