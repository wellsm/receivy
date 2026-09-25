import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { WhatsappInstanceState } from '@receivy/common';

/**
 * The owner's own number on the Evolution API: one instance per owner, named after them. `token`
 * is the instance apikey and `webhook_secret` what Evolution sends back in `authorization`; only
 * the transport and the webhook read them, and nothing serialises them to a client.
 */
export interface WhatsappInstanceSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  name: String.Max<64>;
  token: String.Max<128>;
  webhook_secret: String.Max<64>;
  state: WhatsappInstanceState;
  /** The paired number, from `connection.update`. */
  phone?: String.Max<32>;
  /** The last QR (base64 PNG) while pending; cleared when the instance opens. */
  qr?: String.Max<16384>;
  /** The "connect with phone number" code while pending; cleared with the QR when the instance opens. */
  pairing_code?: String.Max<16>;
  connected_at?: String.DateTime;
  disconnected_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
