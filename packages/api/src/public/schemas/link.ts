import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/** Same shape as `events.eventable_type`: the table is generic, the pair says what it points at. */
export const enum LinkableType {
  Charge = 'charge',
  BillingInvite = 'billing_invite'
}

/**
 * Every public handle in one table: the payment link of a charge and the join link of a billing. Rotating
 * revokes the live row and inserts a new one, which is what gives the history for free; "one live link per
 * target" is held by the repository, since EZ4 declares no partial index.
 */
export interface LinkSchema extends Database.Schema {
  id: String.UUID;
  linkable_type: LinkableType;
  linkable_id: String.UUID;
  /** Random base64url handle; the signed token is derived from it and never stored. */
  public_id: String.Max<64>;
  /**
   * Carried into the signature. The row is the rotation now, so new links are always 1; it stays while the
   * tokens minted from the old `charges.link_version` must keep verifying, and goes with that column.
   */
  version: number;
  expires_at: String.DateTime;
  revoked_at?: String.DateTime;
  /** Invite only: how many people joined through this link. Null on a charge link. */
  accepted_count?: number;
  created_at: String.DateTime;
}
