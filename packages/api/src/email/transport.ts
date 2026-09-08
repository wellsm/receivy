import type { EmailTransport } from "../auth/email-login";
import type { EmailSender } from "./types";

/** Login-code adapter over the vendor chosen by the factory (./factory.ts). */
export function createEmailTransport(sender: EmailSender, from: string): EmailTransport {
  return {
    async sendLoginCode({ code, email }) {
      const result = await sender.send({
        from,
        to: email,
        subject: "Seu código de acesso ao Receivy",
        text: `Seu código de acesso é ${code}. Ele expira em 10 minutos.`,
      });
      if (result.status === "accepted" || result.status === "disabled") return;
      throw new Error("Email delivery failed");
    },
  };
}
