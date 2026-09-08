import type { EmailSender, EmailTransportMode } from "./types";
import { createDisabledSender } from "./disabled";
import { createFileSender } from "./vendors/file";
import { createResendSender } from "./vendors/resend";

export interface EmailSenderOptions {
  /** `EMAIL_TRANSPORT` or `NOTIFICATION_EMAIL_TRANSPORT`. */
  transport: string | undefined;
  /** `APP_STAGE`; `file` is refused anywhere but `local`. */
  stage: string | undefined;
  apiKey?: string;
  /** Overrides `.ez4/emails` (tests). */
  fileDirectory?: string;
  fetch?: typeof fetch;
}

const MODES: readonly EmailTransportMode[] = ["disabled", "file", "resend"];

/**
 * Picks the vendor for a transport setting, like a provider factory: `resend`
 * posts to the Resend API, `file` writes `.eml` files under `.ez4/emails/` for
 * local development, `disabled` drops the message silently. Misconfiguration
 * throws here, at construction, so a deployed stage fails loudly instead of
 * writing mail to the Lambda filesystem or silently skipping delivery.
 */
export function createEmailSender(options: EmailSenderOptions): EmailSender {
  const mode = (options.transport ?? "disabled") as EmailTransportMode;
  if (!MODES.includes(mode)) throw new Error(`Unknown email transport "${options.transport}"`);
  switch (mode) {
    case "disabled":
      return createDisabledSender();
    case "file":
      if (options.stage !== "local") throw new Error("Email transport 'file' is only allowed when APP_STAGE=local");
      return createFileSender({ directory: options.fileDirectory });
    case "resend":
      if (!options.apiKey || options.apiKey === "disabled") throw new Error("Email transport 'resend' requires RESEND_API_KEY");
      return createResendSender({ apiKey: options.apiKey, fetch: options.fetch });
  }
}
