export type EmailTransportMode = "disabled" | "file" | "resend";

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Stable idempotency key for retried deliveries (notifications). */
  key?: string;
}

export type EmailSendResult =
  | { status: "accepted"; id: string }
  | { status: "disabled" | "transient" | "permanent" | "uncertain" };

/** One sender per transport; the factory in ./factory.ts picks the vendor. */
export interface EmailSender {
  readonly mode: EmailTransportMode;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
