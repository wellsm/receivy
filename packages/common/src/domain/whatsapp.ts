import type { WhatsappInstanceState, WhatsappSender } from './notifications';

/** What a client sees of the owner's own-number instance; never the token or the webhook secret. */
export type WhatsappInstanceView = {
  state: WhatsappInstanceState;
  phone: string | null;
  /** The QR to scan, base64 PNG, only while `pending`. */
  qr: string | null;
  /** The 8-char code for "Conectar com número de telefone"; only while pending and only when a phone was given. */
  pairingCode: string | null;
  connectedAt: string | null;
  /** When the phone last dropped; set while `closed`. */
  disconnectedAt: string | null;
};

/** Receivy-number messages spent in the plan cycle; `cycleEnd` null when there is no subscription period. */
export type WhatsappQuota = { used: number; limit: number; cycleEnd: string | null };

export type WhatsappSettings = {
  /** Whether any WhatsApp transport is switched on in this environment. */
  available: boolean;
  /** Whether the own-number path (Evolution) is configured in this environment. */
  ownAvailable: boolean;
  sender: WhatsappSender;
  instance: WhatsappInstanceView | null;
  /** Null when the plan has no WhatsApp quota (Free). */
  quota: WhatsappQuota | null;
};
