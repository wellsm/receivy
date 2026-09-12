import type { ChargeDetail, ProofUploadTicket } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const ACCEPTED = ["image/jpeg", "image/png", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 30;

export const PROOF_ACCEPT = ACCEPTED.join(",");

/** The API answers 409 for two reasons on this path; the generic conflict copy would hide both. */
export const UPLOAD_CONFLICT = "Já existe um comprovante em revisão ou um envio em andamento nesta cobrança. Aguarde alguns minutos ou atualize a tela.";

/** The bytes are up but the bucket event has not reached the API yet; the file may still show up. */
export const UPLOAD_UNCONFIRMED = "Não foi possível confirmar o envio. Atualize a página.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** The client confirms nothing: the API learns about the file from the bucket event, so the charge is read until the proof shows up. */
async function waitForPendingProof(base: string): Promise<ChargeDetail> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(POLL_INTERVAL_MS);
    }

    const response = await browserFetch(base);

    if (!response.ok) {
      continue;
    }

    const charge = (await response.json()) as ChargeDetail;

    if (charge.proof?.state === "pending") {
      return charge;
    }
  }

  throw new Error(UPLOAD_UNCONFIRMED);
}

/** Sends a picked file for the charge at `base`: ticket, signed PUT, then polls the charge. Mirrors the mobile `pickAndUploadProof`. */
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

  return waitForPendingProof(base);
}
