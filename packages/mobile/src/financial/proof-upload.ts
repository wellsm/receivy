import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import type { FinancialClient } from "./client";
import type { ProofUploadInput } from "@receivy/common";

/** Must be called directly from a user-triggered action, including Expo web. */
export async function pickAndUploadProof(id: string, client: Pick<FinancialClient, "uploadIntent" | "finalizeProof">) {
  const result = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "application/pdf"], multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0]; if (!asset) return null;
  const file = asset.file ?? new File(asset.uri); const size = asset.size ?? file.size; const mime = asset.mimeType;
  if (!mime || !["image/jpeg", "image/png", "application/pdf"].includes(mime) || !size || size > 10 * 1024 * 1024) throw new Error("Selecione JPG, PNG ou PDF de até 10 MB.");
  const intent = await client.uploadIntent(id, { filename: asset.name, mime: mime as ProofUploadInput["mime"], size });
  const response = await expoFetch(intent.uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: file });
  if (!response.ok) throw new Error("O arquivo não foi enviado. Aguarde cinco minutos para iniciar outro envio.");
  return client.finalizeProof(id, intent.id);
}
