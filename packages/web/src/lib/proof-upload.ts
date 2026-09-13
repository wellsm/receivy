import type { ChargeDetail, ProofUploadTicket } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const ACCEPTED = ["image/jpeg", "image/png", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;

export const PROOF_ACCEPT = ACCEPTED.join(",");

/** The API answers 409 for two reasons on this path; the generic conflict copy would hide both. */
export const UPLOAD_CONFLICT = "Já existe um comprovante em revisão ou um envio em andamento nesta cobrança. Aguarde alguns minutos ou atualize a tela.";

/** The bytes are up but the API could not attach them; the file may still show up. */
export const UPLOAD_UNCONFIRMED = "Não foi possível confirmar o envio. Atualize a página.";

async function post<T>(path: string, body: object, fallback: string, conflict?: string): Promise<T> {
  const response = await browserFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status === 409 && conflict) {
    throw new Error(conflict);
  }

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return (await response.json()) as T;
}

/** Sends a picked file for the charge at `base`: ticket, signed PUT, then completes the upload. Mirrors the mobile `pickAndUploadProof`. */
export async function uploadProofFile(base: string, file: File): Promise<ChargeDetail> {
  if (!ACCEPTED.includes(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
    throw new Error("Selecione JPG, PNG ou PDF de até 10 MB.");
  }

  const ticket = await post<ProofUploadTicket>(
    `${base}/proof`,
    { filename: file.name, mime: file.type, size: file.size },
    "Não foi possível iniciar o envio.",
    UPLOAD_CONFLICT,
  );
  const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file, credentials: "omit", referrerPolicy: "no-referrer" });

  if (!put.ok) {
    throw new Error("O arquivo não foi enviado. Aguarde cinco minutos para iniciar outro envio.");
  }

  // The client confirms the bytes landed; the bucket event does the same work where it exists.
  const complete = await browserFetch(`${base}/proof/complete`, { method: "POST" });

  if (!complete.ok) {
    throw new Error(await responseMessage(complete, UPLOAD_UNCONFIRMED));
  }

  return (await complete.json()) as ChargeDetail;
}
