import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface OauthGrantSchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  grant_hash: String.Max<64>;
  client_challenge: String.Max<64>;
  expires_at: String.DateTime;
  consumed_at?: String.DateTime;
  created_at: String.DateTime;
}
