"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChargeState, ProofDetail, ProofUploadIntent } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
class ProofRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type PublicProofStatus = Pick<ProofDetail, "state" | "reason" | "closureReason">;
async function readPublicProofStatus(base: string, id: string): Promise<PublicProofStatus | null> {
  try {
    const response = await fetch(`${base}/uploads/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const status = await response.json() as PublicProofStatus;
    return ["pending", "accepted", "rejected"].includes(status.state) ? status : null;
  } catch { return null; }
}
function storedIntent(): string | null { try { return sessionStorage.getItem("receivy-proof-intent"); } catch { return null; } }

export function ProofPanel({ base, state, creditor = false, publicView = false, uploadsEnabled = true, onChanged }: {
  base: string; state: ChargeState; creditor?: boolean; publicView?: boolean; uploadsEnabled?: boolean; onChanged?: () => void;
}) {
  const [proofs, setProofs] = useState<ProofDetail[]>([]); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(false);
  const [reason, setReason] = useState(""); const [intent, setIntent] = useState<ProofUploadIntent | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [publicStatus, setPublicStatus] = useState<PublicProofStatus | null>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const confirmedIntent = useRef<string | null>(null);
  const activeUpload = useRef<string | null>(null);
  const request = publicView ? fetch : browserFetch;
  const showPublicStatus = useCallback((status: PublicProofStatus, id: string) => {
    confirmedIntent.current = id;
    setPublicStatus(status); setSent(status.state === "pending"); setError("");
    if (activeUpload.current === id) {
      activeUpload.current = null; setIntent(null); setFile(null);
    }
  }, []);
  useEffect(() => {
    if (!intent) return;
    const timer = setTimeout(() => {
      if (confirmedIntent.current === intent.id) return;
      activeUpload.current = null;
      setIntent(null); setFile(null); setSelectionVersion(version => version + 1);
      setError("O envio expirou. Selecione o arquivo novamente ou escolha outro.");
    }, Math.max(0, Date.parse(intent.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [intent]);
  useEffect(() => { if (!publicView) return; let stopped = false;
    setRecoveryId(storedIntent());
    const check = async () => { const id = storedIntent(); if (!id) return;
      const status = await readPublicProofStatus(base, id);
      if (status && !stopped && storedIntent() === id) showPublicStatus(status, id);
    }; void check(); const timer = setInterval(() => void check(), 15_000); return () => { stopped = true; clearInterval(timer); };
  }, [base, publicView, showPublicStatus]);
  useEffect(() => { if (!publicView) void browserFetch(base).then(async response => {
    if (!response.ok) throw new Error("Não foi possível carregar os comprovantes.");
    const data = await response.json() as { proofs?: ProofDetail[] }; setProofs(data.proofs ?? []);
  }).catch(() => setError("Não foi possível carregar os comprovantes.")); }, [base, publicView, state]);
  async function json(path: string, body?: object) {
    const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new ProofRequestError(await responseMessage(response, "Não foi possível processar o comprovante."), response.status);
    return response.json();
  }
  async function upload() {
    if (!file) return;
    setBusy(true); setError("");
    let finalizing: ProofUploadIntent | null = null;
    try {
      if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("Selecione JPG, PNG ou PDF de até 10 MB.");
      const active = intent && Date.parse(intent.expiresAt) > Date.now() ? intent : await json(`${base}/uploads`, { filename: file.name, mime: file.type, size: file.size }) as ProofUploadIntent;
      activeUpload.current = active.id;
      setIntent(active);
      if (publicView) {
        // Persist only the opaque handle before the request can commit, never the capability or signed URL.
        sessionStorage.setItem("receivy-proof-intent", active.id); setRecoveryId(active.id); setPublicStatus(null);
      }
      const response = await fetch(active.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("O arquivo não foi enviado. Tente novamente.");
      finalizing = active;
      const finalized = await json(`${base}/uploads/${active.id}/finalize`);
      if (publicView) showPublicStatus({ state: "pending", reason: null, closureReason: null }, active.id);
      activeUpload.current = null; setSent(true); setIntent(null); setFile(null); setError("");
      if (!publicView) setProofs(previous => [...previous, finalized as ProofDetail]);
      onChanged?.();
    } catch (failure) {
      if (publicView && finalizing && confirmedIntent.current === finalizing.id) return;
      if (failure instanceof ProofRequestError && failure.status === 422) {
        activeUpload.current = null;
        setIntent(null); setFile(null); setSelectionVersion(version => version + 1);
        if (publicView && finalizing) {
          if (storedIntent() === finalizing.id) { try { sessionStorage.removeItem("receivy-proof-intent"); } catch { /* State still clears in memory. */ } }
          setRecoveryId(null);
        }
      } else if (publicView && finalizing) {
        const status = await readPublicProofStatus(base, finalizing.id);
        if (status) { showPublicStatus(status, finalizing.id); onChanged?.(); return; }
        if (confirmedIntent.current === finalizing.id) return;
        setError("Não foi possível confirmar o envio. Verifique a situação antes de tentar novamente.");
        return;
      }
      setError(failure instanceof Error ? failure.message : "Não foi possível enviar o comprovante.");
    }
    finally { setBusy(false); }
  }
  async function verifyUpload() {
    if (!recoveryId) return;
    setBusy(true);
    const status = await readPublicProofStatus(base, recoveryId);
    if (status) showPublicStatus(status, recoveryId);
    else setError("Não foi possível confirmar o envio. Verifique a situação antes de tentar novamente.");
    setBusy(false);
  }
  async function review(proof: ProofDetail, decision: "accepted" | "rejected") {
    setBusy(true); setError(""); try {
      const updated = await json(`${base}/${proof.id}/review`, { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }) as ProofDetail;
      setProofs(previous => previous.map(item => item.id === proof.id ? updated : item)); setReason(""); onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível revisar."); } finally { setBusy(false); }
  }
  async function download(id: string) {
    setBusy(true); try { const result = await json(`${base}/${id}/download`) as { url: string }; window.location.assign(result.url); }
    catch { setError("Não foi possível baixar o comprovante."); } finally { setBusy(false); }
  }
  const effectiveState = publicStatus?.state === "accepted" ? "paid" : publicStatus?.closureReason ?? state;
  const pending = sent || proofs.some(proof => proof.state === "pending") || (!uploadsEnabled && publicStatus?.state !== "rejected");
  return <section className="detail-section"><h2>Comprovantes</h2>
    {publicView && recoveryId && !publicStatus && effectiveState === "pending" && <button type="button" disabled={busy} onClick={() => void verifyUpload()}>Verificar envio</button>}
    {publicStatus?.state === "rejected" && !publicStatus.closureReason && <p>Comprovante rejeitado{publicStatus.reason ? `: ${publicStatus.reason}` : "."} Você pode enviar outro arquivo.</p>}
    {effectiveState !== "pending" ? <p>Não pague nem envie outro comprovante: esta cobrança está {effectiveState === "paid" ? "paga" : "cancelada"}.</p>
      : pending ? <p role="status">Comprovante enviado para revisão.</p>
        : !creditor && <><p>Envie JPG, PNG ou PDF de até 10 MB. O credor confirmará o pagamento após revisar.</p><label>Comprovante JPG, PNG ou PDF<input key={selectionVersion} type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy || !!intent} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" disabled={busy || !file} onClick={() => void upload()}>Enviar comprovante</button></>}
    {proofs.map(proof => <article key={proof.id}><p>{proof.originalName} · {proof.state === "pending" ? "Em revisão" : proof.state === "accepted" ? "Aceito" : "Encerrado"}</p>
      {proof.closureReason ? <p>{proof.closureReason === "paid" ? "Encerrado porque a cobrança foi paga manualmente." : "Encerrado porque a cobrança foi cancelada."}</p> : proof.state === "rejected" && <p>Comprovante rejeitado{proof.reason ? `: ${proof.reason}` : "."} {state === "pending" && "Você pode enviar outro arquivo."}</p>}
      <button disabled={busy} onClick={() => void download(proof.id)}>Baixar comprovante</button>
      {creditor && state === "pending" && proof.state === "pending" && <><label>Motivo opcional<input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy} onClick={() => { if (window.confirm("Aceitar e registrar o pagamento integral?")) void review(proof, "accepted"); }}>Aceitar comprovante</button><button disabled={busy} onClick={() => void review(proof, "rejected")}>Rejeitar comprovante</button></>}
    </article>)}{error && <p role="alert">{error}</p>}
  </section>;
}
