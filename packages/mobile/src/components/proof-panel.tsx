import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import type { ChargeDetail, ProofDetail } from "@receivy/common";
import type { FinancialClient } from "@/financial/client";
import { pickAndUploadProof } from "@/financial/proof-upload";
export type ProofClient = Pick<FinancialClient, "proofs" | "uploadIntent" | "finalizeProof" | "reviewProof" | "downloadProof">;
export function ProofPanel({ charge, client, onChanged }: { charge: ChargeDetail; client: ProofClient; onChanged: () => void }) {
  const [proofs, setProofs] = useState<ProofDetail[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reason, setReason] = useState("");
  useEffect(() => { void client.proofs(charge.id).then(result => setProofs(result.proofs)).catch(() => setError("Não foi possível carregar comprovantes.")); }, [client, charge.id, charge.state]);
  async function upload() { setBusy(true); setError(""); try { const proof = await pickAndUploadProof(charge.id, client); if (proof) { setProofs(previous => [...previous, proof]); onChanged(); } } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível enviar."); } finally { setBusy(false); } }
  async function review(proofId: string, decision: "accepted" | "rejected") { setBusy(true); setError(""); try { const proof = await client.reviewProof(charge.id, proofId, decision, reason); setProofs(previous => previous.map(item => item.id === proofId ? proof : item)); onChanged(); } catch { setError("Não foi possível revisar o comprovante."); } finally { setBusy(false); } }
  async function download(proofId: string) { setBusy(true); try { const { url } = await client.downloadProof(charge.id, proofId); await Linking.openURL(url); } catch { setError("Não foi possível baixar o comprovante."); } finally { setBusy(false); } }
  const button = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} className="min-h-12 items-center justify-center rounded-xl border border-outline"><Text className="font-bold text-primary">{label}</Text></Pressable>;
  return <View className="gap-3 rounded-3xl border border-outline bg-surface p-5"><Text className="text-xl font-bold text-primary-strong">Comprovantes</Text>
    {charge.state !== "pending" ? <Text>Não pague nem envie outro comprovante: esta cobrança está encerrada.</Text> : proofs.some(proof => proof.state === "pending") ? <Text>Comprovante enviado para revisão.</Text> : charge.direction === "payable" && <><Text>JPG, PNG ou PDF de até 10 MB.</Text>{button("Selecionar e enviar comprovante", () => void upload())}</>}
    {proofs.map(proof => <View key={proof.id} className="gap-2"><Text>{proof.originalName} · {proof.state === "pending" ? "Em revisão" : proof.state === "accepted" ? "Aceito" : "Encerrado"}</Text>
      {proof.closureReason ? <Text>{proof.closureReason === "paid" ? "Encerrado porque a cobrança foi paga manualmente." : "Encerrado porque a cobrança foi cancelada."}</Text> : proof.state === "rejected" && <Text>Comprovante rejeitado{proof.reason ? `: ${proof.reason}` : "."} {charge.state === "pending" && "Você pode enviar outro arquivo."}</Text>}
      {button("Baixar comprovante", () => void download(proof.id))}
      {charge.direction === "receivable" && charge.state === "pending" && proof.state === "pending" && <><TextInput accessibilityLabel="Motivo opcional" placeholder="Motivo opcional" maxLength={500} value={reason} onChangeText={setReason} />{button("Aceitar comprovante", () => Alert.alert("Aceitar comprovante?", "Isso registra o pagamento integral.", [{ text: "Voltar", style: "cancel" }, { text: "Aceitar", onPress: () => void review(proof.id, "accepted") }]))}{button("Rejeitar comprovante", () => void review(proof.id, "rejected"))}</>}
    </View>)}{error && <Text accessibilityRole="alert">{error}</Text>}
  </View>;
}
