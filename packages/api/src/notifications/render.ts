import { issuePublicChargeToken } from "../public/capability";
export interface RenderInputs {
  email?: string;
  name: string;
  description: string;
  cents: number;
  dueDate: string;
  publicId: string;
  version: number;
  expires: number;
  origin: string;
  from: string;
}
export function renderNotice(
  input: RenderInputs,
  template: "initial" | "reminder",
  secret: string,
) {
  const token = issuePublicChargeToken({
    publicId: input.publicId,
    version: input.version,
    expiresAtSeconds: input.expires,
    secret,
  });
  const url = `${input.origin}/pay/${token}`;
  const subject =
    template === "initial"
      ? "Uma nova cobrança no Receivy"
      : "Lembrete de cobrança no Receivy";
  const amount = `${Math.floor(input.cents / 100)},${String(input.cents % 100).padStart(2, "0")}`;
  const text = `${input.name}, ${template === "initial" ? "você recebeu uma cobrança" : "há uma cobrança pendente"} de R$ ${amount}, com vencimento em ${input.dueDate}.\n${input.description}\nConfira os detalhes: ${url}\nSe já pagou, envie o comprovante para revisão. O Receivy não movimenta dinheiro.`;
  return { subject, text, url };
}
