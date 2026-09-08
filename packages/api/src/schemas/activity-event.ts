import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface ActivityEventSchema extends Database.Schema {
  id: String.UUID;
  actor_user_id?: String.UUID;
  subject_user_id?: String.UUID;
  type: String.Max<80>;
  aggregate_type: String.Max<40>;
  aggregate_id: String.UUID;
  payload: String.Max<4000>;
  created_at: String.DateTime;
}
