import type { EmailSender } from "./types";

/** Silent by design: nothing is sent, printed or logged. */
export function createDisabledSender(): EmailSender {
  return { mode: "disabled", async send() { return { status: "disabled" }; } };
}
