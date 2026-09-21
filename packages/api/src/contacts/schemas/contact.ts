import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/** One agenda entry: the owner knows the person behind `user_id`, optionally by a nickname. */
export interface ContactSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  user_id: String.UUID;
  nickname?: String.Max<60>;
  /** E.164, typed by the owner; the person's own `users.phone` wins over it. */
  phone?: String.Max<40>;
  /** The owner declared this person agreed to WhatsApp notices; absent blocks the channel through this contact. */
  whatsapp_consent_at?: String.DateTime;
  archived_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
