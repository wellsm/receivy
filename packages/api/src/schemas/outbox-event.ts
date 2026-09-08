import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

export interface OutboxEventSchema extends Database.Schema {
  id: String.UUID;
  type: String.Max<80>;
  aggregate_type: String.Max<40>;
  aggregate_id: String.UUID;
  recipient_user_id?: String.UUID;
  recipient_email?: String.Max<254>;
  payload: String.Max<4000>;
  state: 'pending' | 'processing' | 'delivered' | 'failed';
  attempts: number;
  available_at: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
