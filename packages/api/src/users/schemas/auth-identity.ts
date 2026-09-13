import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { AuthProvider } from '@receivy/common';

export interface AuthIdentitySchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  provider: AuthProvider;
  provider_user_id: String.Max<320>;
  email: String.Email;
  email_verified: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
