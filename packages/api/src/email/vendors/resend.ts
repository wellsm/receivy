import type { EmailSender } from "../types";

/** Provider bodies and errors never escape this boundary or enter logs. */
export function createResendSender(options: { apiKey: string; fetch?: typeof fetch }): EmailSender {
  const request = options.fetch ?? globalThis.fetch;
  return {
    mode: "resend",
    async send(message) {
      try {
        const response = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            ...(message.key ? { "Idempotency-Key": message.key } : {}),
          },
          body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return { status: response.status === 429 || response.status >= 500 ? "transient" : "permanent" };
        const body = (await response.json().catch(() => ({}))) as { id?: unknown };
        return typeof body.id === "string" ? { status: "accepted", id: body.id } : { status: "uncertain" };
      } catch {
        return { status: "uncertain" };
      }
    },
  };
}
