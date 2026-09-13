import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { OauthProvider } from '../services/oauth';

export interface OauthAttemptSchema extends Database.Schema {
  id: String.UUID;
  state_hash: String.Max<64>;
  client_challenge: String.Max<64>;
  provider: OauthProvider;
  destination: String.Max<512>;
  code_verifier: String.Max<128>;
  nonce: String.Max<128>;
  expires_at: String.DateTime;
  consumed_at?: String.DateTime;
  created_at: String.DateTime;
}
