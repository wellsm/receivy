import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/** One agenda entry: the owner knows the person behind `user_id`, optionally by a nickname. */
export interface ContactSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  user_id: String.UUID;
  nickname?: String.Max<60>;
  archived_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
