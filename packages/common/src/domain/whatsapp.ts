import type { WhatsappInstanceState, WhatsappSender } from './notifications';

/** What a client sees of the owner's own-number instance; never the token or the webhook secret. */
export type WhatsappInstanceView = {
  state: WhatsappInstanceState;
  phone: string | null;
  /** The QR to scan, base64 PNG, only while `pending`. */
  qr: string | null;
  connectedAt: string | null;
};

export type WhatsappSettings = {
  /** Whether any WhatsApp transport is switched on in this environment. */
  available: boolean;
  sender: WhatsappSender;
  instance: WhatsappInstanceView | null;
};
