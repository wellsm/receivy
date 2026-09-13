import type { Database } from '@ez4/database';
import type { Object, String } from '@ez4/schema';

export const enum EventableType {
  Charge = 'charge',
  Billing = 'billing',
  Account = 'account',
  Contact = 'contact',
  Notification = 'notification'
}

/**
 * The immutable log: what happened to a charge, a billing, an account or a contact, by whom, with
 * whatever the type needs to remember (a rejected file's name and reason, the channels a notice
 * reached). Reads that need history join here; nothing here changes state.
 */
export interface EventSchema extends Database.Schema {
  id: String.UUID;
  eventable_type: EventableType;
  eventable_id: String.UUID;
  type: String.Max<80>;
  actor_user_id?: String.UUID;
  payload: Object.Any;
  created_at: String.DateTime;
}
