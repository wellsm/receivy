import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { UserStatus } from '@receivy/common';

export interface UserSchema extends Database.Schema {
  id: String.UUID;
  /** Absent only on a placeholder typed by an owner without an address; every login has one. */
  email?: String.Email;
  verified_email?: String.Email;
  name?: String.Max<120>;
  /** Filled by the person at onboarding, never by whoever added them as a contact. */
  phone?: String.Max<40>;
  /** JSON `ReminderConfig`; absent means the system default. */
  reminder_config?: String.Max<2000>;
  /** The person asked, from an e-mail footer, to stop receiving charge notices. */
  email_opt_out_at?: String.DateTime;
  /** Reserved for the WhatsApp quick reply (phase 3); nothing writes it yet. */
  whatsapp_opt_out_at?: String.DateTime;
  avatar_url?: String.Max<512>;
  /** When the photo at `avatars/<id>` was last replaced; absent means no photo. */
  avatar_updated_at?: String.DateTime;
  /**
   * `pending`: created by a contact or a first login, onboarding not done; agendas may still edit name and e-mail.
   * `active`: onboarding done; only the person edits their data. `removed`: account deleted; the id survives for history.
   */
  status: UserStatus;
  locale: 'pt-BR';
  timezone: String.Max<64>;
  country: 'BR';
  currency: 'BRL';
  created_at: String.DateTime;
  updated_at: String.DateTime;
  deleted_at?: String.DateTime;
}
