import type { EmailTransport } from "../auth/email-login";

type Fetch = typeof fetch;

type EmailTransportOptions =
  | { mode: "disabled"; fetch?: Fetch }
  | {
      mode: "resend";
      apiKey: string;
      from: string;
      fetch?: Fetch;
    };

export function createEmailTransport(options: EmailTransportOptions): EmailTransport {
  return {
    async sendLoginCode({ code, email }) {
      if (options.mode === "disabled") {
        return;
      }

      const request = options.fetch ?? globalThis.fetch;
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [email],
          subject: "Seu código de acesso ao Receivy",
          text: `Seu código de acesso é ${code}. Ele expira em 10 minutos.`,
        }),
      });

      if (!response.ok) {
        throw new Error("Email delivery failed");
      }
    },
  };
}
