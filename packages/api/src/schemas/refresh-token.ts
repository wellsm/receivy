import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface RefreshTokenSchema extends Database.Schema {
  id: String.UUID;
  family_id: String.UUID;
  token_hash: String.Max<128>;
  expires_at: String.DateTime;
  consumed_at?: String.DateTime;
  created_at: String.DateTime;
}
