import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { FinancialRequestError, type FinancialClient } from "./client";
import type { ChargeDetail, ProofUploadInput } from "@receivy/common";

/** The API answers 409 for two reasons on this path; the generic conflict copy would hide both. */
export const UPLOAD_CONFLICT = "Já existe um comprovante em revisão ou um envio em andamento nesta cobrança. Aguarde alguns minutos ou atualize a tela.";
/** The bucket event may lag; after this long the file is probably there but the screen cannot prove it. */
export const UPLOAD_UNCONFIRMED = "Não foi possível confirmar o envio. Puxe para atualizar.";

const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 30;

function explained(failure: unknown): Error {
  return failure instanceof FinancialRequestError && failure.status === 409 ? new Error(UPLOAD_CONFLICT) : (failure as Error);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** There is no finalize call: the API learns about the file from the bucket, so the charge is polled until the proof shows up. */
async function waitForProof(id: string, client: Pick<FinancialClient, "charge">): Promise<ChargeDetail> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await wait(POLL_INTERVAL_MS);
    const charge = await client.charge(id);
    if (charge.proof?.state === "pending") return charge;
  }
  throw new Error(UPLOAD_UNCONFIRMED);
}

/** Must be called directly from a user-triggered action, including Expo web. Resolves with the refreshed charge, or null when nothing was picked. */
export async function pickAndUploadProof(id: string, client: Pick<FinancialClient, "startProofUpload" | "charge">): Promise<ChargeDetail | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "application/pdf"], multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0]; if (!asset) return null;
  const file = asset.file ?? new File(asset.uri); const size = asset.size ?? file.size; const mime = asset.mimeType;
  if (!mime || !["image/jpeg", "image/png", "application/pdf"].includes(mime) || !size || size > 10 * 1024 * 1024) throw new Error("Selecione JPG, PNG ou PDF de até 10 MB.");
  const ticket = await client.startProofUpload(id, { filename: asset.name, mime: mime as ProofUploadInput["mime"], size }).catch((failure: unknown) => {
    throw explained(failure);
  });
  const response = await expoFetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: file });
  if (!response.ok) throw new Error("O arquivo não foi enviado. Aguarde cinco minutos para iniciar outro envio.");
  return waitForProof(id, client);
}
