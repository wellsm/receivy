import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface BillingInviteSchema extends Database.Schema {
  id: String.UUID;
  billing_id: String.UUID;
  owner_id: String.UUID;
  /** Random base64url handle; the signed token is derived from it and never stored. */
  public_id: String.Max<32>;
  expires_at: String.DateTime;
  revoked_at?: String.DateTime;
  accepted_count: number;
  created_at: String.DateTime;
}
