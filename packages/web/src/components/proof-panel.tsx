"use client";
import { useEffect, useState } from "react";
import type { ChargeState, ProofDetail, ProofUploadIntent } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

export function ProofPanel({ base, state, creditor = false, publicView = false, uploadsEnabled = true, onChanged }: {
  base: string; state: ChargeState; creditor?: boolean; publicView?: boolean; uploadsEnabled?: boolean; onChanged?: () => void;
}) {
  const [proofs, setProofs] = useState<ProofDetail[]>([]); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [sent, setSent] = useState(false);
  const [reason, setReason] = useState(""); const [intent, setIntent] = useState<ProofUploadIntent | null>(null);
  const [publicStatus, setPublicStatus] = useState<Pick<ProofDetail, "state" | "reason" | "closureReason"> | null>(null);
  const request = publicView ? fetch : browserFetch;
  useEffect(() => { if (!publicView) return; let stopped = false;
    const check = async () => { const id = sessionStorage.getItem("receivy-proof-intent"); if (!id) return;
      try { const response = await fetch(`${base}/uploads/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (response.ok && !stopped) { const status = await response.json(); setPublicStatus(status); setSent(status.state === "pending"); }
      } catch { /* Retry on next poll without erasing known state. */ }
    }; void check(); const timer = setInterval(() => void check(), 15_000); return () => { stopped = true; clearInterval(timer); };
  }, [base, publicView]);
  useEffect(() => { if (!publicView) void browserFetch(base).then(async response => {
    if (!response.ok) throw new Error("Não foi possível carregar os comprovantes.");
    const data = await response.json() as { proofs?: ProofDetail[] }; setProofs(data.proofs ?? []);
  }).catch(() => setError("Não foi possível carregar os comprovantes.")); }, [base, publicView, state]);
  async function json(path: string, body?: object) {
    const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível processar o comprovante."));
    return response.json();
  }
  async function upload() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("Selecione JPG, PNG ou PDF de até 10 MB.");
      const active = intent && Date.parse(intent.expiresAt) > Date.now() ? intent : await json(`${base}/uploads`, { filename: file.name, mime: file.type, size: file.size }) as ProofUploadIntent;
      setIntent(active);
      const response = await fetch(active.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("O arquivo não foi enviado. Tente novamente.");
      const finalized = await json(`${base}/uploads/${active.id}/finalize`);
      if (publicView) { sessionStorage.setItem("receivy-proof-intent", active.id); setPublicStatus({ state: "pending", reason: null, closureReason: null }); }
      setSent(true); setIntent(null); setFile(null);
      if (!publicView) setProofs(previous => [...previous, finalized as ProofDetail]);
      onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível enviar o comprovante."); }
    finally { setBusy(false); }
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
    {publicStatus?.state === "rejected" && !publicStatus.closureReason && <p>Comprovante rejeitado{publicStatus.reason ? `: ${publicStatus.reason}` : "."} Você pode enviar outro arquivo.</p>}
    {effectiveState !== "pending" ? <p>Não pague nem envie outro comprovante: esta cobrança está {effectiveState === "paid" ? "paga" : "cancelada"}.</p>
      : pending ? <p role="status">Comprovante enviado para revisão.</p>
        : !creditor && <><p>Envie JPG, PNG ou PDF de até 10 MB. O credor confirmará o pagamento após revisar.</p><label>Comprovante JPG, PNG ou PDF<input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy || !!intent} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" disabled={busy || !file} onClick={() => void upload()}>Enviar comprovante</button></>}
    {proofs.map(proof => <article key={proof.id}><p>{proof.originalName} · {proof.state === "pending" ? "Em revisão" : proof.state === "accepted" ? "Aceito" : "Encerrado"}</p>
      {proof.closureReason ? <p>{proof.closureReason === "paid" ? "Encerrado porque a cobrança foi paga manualmente." : "Encerrado porque a cobrança foi cancelada."}</p> : proof.state === "rejected" && <p>Comprovante rejeitado{proof.reason ? `: ${proof.reason}` : "."} {state === "pending" && "Você pode enviar outro arquivo."}</p>}
      <button disabled={busy} onClick={() => void download(proof.id)}>Baixar comprovante</button>
      {creditor && state === "pending" && proof.state === "pending" && <><label>Motivo opcional<input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy} onClick={() => { if (window.confirm("Aceitar e registrar o pagamento integral?")) void review(proof, "accepted"); }}>Aceitar comprovante</button><button disabled={busy} onClick={() => void review(proof, "rejected")}>Rejeitar comprovante</button></>}
    </article>)}{error && <p role="alert">{error}</p>}
  </section>;
}
