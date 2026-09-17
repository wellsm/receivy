import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { ProofKind } from '@receivy/common';
import type { ProofFileSchema, StoredProofState } from '../../charges/schemas/charge';

/**
 * The single proof a charge is waiting on, or the answered one it keeps. There is at most one row per
 * charge: withdrawing deletes it, and what happened to the earlier ones lives in `events`. The invariant
 * is held by the repository, inside the same transaction that locks the charge — EZ4 declares no partial
 * index, and a plain unique on `charge_id` would forbid ever sending a second file.
 */
export interface ProofSchema extends Database.Schema {
  id: String.UUID;
  charge_id: String.UUID;
  state: StoredProofState;
  /** File or declaration; a declaration has no `file` until one is sent over it. */
  kind: ProofKind;
  file?: ProofFileSchema;
  /** Who sent it: a signed-in payer, or nobody when it came through the public link. */
  sender_user_id?: String.UUID;
  /** Hash of the sender (user id or public token) so the same actor may replace or withdraw it. */
  actor_hash: String.Max<64>;
  /** Only while `uploading`, or while a file is on its way over a declaration: when the slot expires. */
  expires_at?: String.DateTime;
  sent_at?: String.DateTime;
  reviewed_at?: String.DateTime;
  reason?: String.Max<500>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
