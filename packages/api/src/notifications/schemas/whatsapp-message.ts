import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { WhatsappMessageStatus, WhatsappSender } from '@receivy/common';
import type { NoticeTemplate } from '../services/render';

/**
 * One row per delivery attempt, including the failed ones. It answers two questions: how many
 * messages the owner spent on the Receivy number this cycle (quota), and which charge a status
 * webhook is about (`provider_message_id`). `to` keeps the number as it was sent: the contact
 * may be corrected later and the row must still say where the message went.
 */
export interface WhatsappMessageSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  charge_id: String.UUID;
  to: String.Max<32>;
  sender: WhatsappSender;
  template: NoticeTemplate;
  status: WhatsappMessageStatus;
  /** The Meta `wamid` or the Evolution `key.id`; absent until the provider accepted the message. */
  provider_message_id?: String.Max<128>;
  error?: String.Max<512>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
