import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/**
 * Someone who accepted an invite while the split still named contacts without e-mail. They wait
 * here until the owner links them to one of those contacts, adds them as a new participant or
 * dismisses them.
 */
export interface BillingGuestSchema extends Database.Schema {
  id: String.UUID;
  billing_id: String.UUID;
  owner_id: String.UUID;
  user_id: String.UUID;
  state: 'pending' | 'linked' | 'added' | 'dismissed';
  created_at: String.DateTime;
  resolved_at?: String.DateTime;
}
