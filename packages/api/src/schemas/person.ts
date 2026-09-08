import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface PersonSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  linked_user_id?: String.UUID;
  name: String.Max<120>;
  active_email?: String.Max<254>;
  archived_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
