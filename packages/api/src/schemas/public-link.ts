import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface PublicLinkSchema extends Database.Schema {
  id: String.UUID;
  public_id: String.Max<64>;
  charge_id: String.UUID;
  token_version: number;
  expires_at: String.DateTime;
  revoked_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
