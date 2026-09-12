import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface SessionFamilySchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  device_name?: String.Max<120>;
  revoked_at?: String.DateTime;
  created_at: String.DateTime;
  last_seen_at: String.DateTime;
}
