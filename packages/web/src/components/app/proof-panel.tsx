"use client";
import { useEffect, useState } from "react";
import { fileSizeText, ProofKind, type ChargeState, type ProofUploadTicket, type PublicProofState } from "@receivy/common";
import { responseMessage } from "@/lib/financial-response";
import { CloudUpload, FileText, Loader2, Receipt, Trash2 } from "lucide-react";

const HINT = "m-0 text-sm leading-5 text-muted";
const PRIMARY_BUTTON = "inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-[15px] font-bold text-surface transition hover:opacity-90 disabled:opacity-50";
const DANGER_BUTTON = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-danger/30 px-4 text-sm font-semibold text-danger transition hover:bg-danger-soft disabled:opacity-50";
const FILE_INPUT_LABEL = "Comprovante JPG, PNG ou PDF";
/** Only a flag: the API knows the slot by the payer, so a reload just asks it again. */
const STARTED_KEY = "receivy-proof-upload";
const UNCONFIRMED = "Não foi possível confirmar o envio. Atualize a página.";
const NOT_STORED = "O envio anterior não foi concluído. Selecione o arquivo e envie novamente.";

/** What the panel knows about the file on screen: the selection before sending, the sent one afterwards. */
type ProofPreview = { name: string; size: number; mime: string; url: string | null };

function objectUrl(file: File): string | null {
  if (!file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") {
    return null;
  }

  return URL.createObjectURL(file);
}

function revoke(preview: ProofPreview | null) {
  if (preview?.url && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(preview.url);
  }
}

/** Thumbnail for an image, a document mark otherwise; the name and size always read. */
function PreviewCard({ preview, children }: { preview: ProofPreview; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-outline/30 bg-surface-muted/50 p-3">
      {preview.url ? (
        // A blob URL from the payer's own device: nothing for next/image to optimise or serve.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.url} alt={`Prévia de ${preview.name}`} className="max-h-56 w-full rounded-lg object-contain" />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg bg-surface">
          <FileText size={32} aria-hidden="true" className="text-primary" />
        </div>
      )}

      <p className="m-0 truncate text-sm font-semibold text-ink">
        {preview.name} <span className="font-normal text-muted">· {fileSizeText(preview.size)}</span>
      </p>

      {children}
    </div>
  );
}
function uploadStarted(): boolean { try { return sessionStorage.getItem(STARTED_KEY) === "1"; } catch { return false; } }
function rememberUpload() { try { sessionStorage.setItem(STARTED_KEY, "1"); } catch { /* A reload then reads the slot once instead of polling it. */ } }
function forgetUpload() { try { sessionStorage.removeItem(STARTED_KEY); } catch { /* State still clears in memory. */ } }
/** `null` means the lookup itself failed; a `state: null` answer means there is no slot for this payer. */
async function readStatus(base: string): Promise<PublicProofState | null> {
  try {
    const response = await fetch(`${base}/proof`, { cache: "no-store" });

    if (!response.ok) {
      return null;
    }

    return await response.json() as PublicProofState;
  } catch { return null; }
}
/** Tells the API the bytes landed; `null` when it could not attach them, so the flag stays for a reload. */
async function completeStatus(base: string): Promise<PublicProofState | null> {
  try {
    const response = await fetch(`${base}/proof/complete`, { method: "POST" });

    if (!response.ok) {
      return null;
    }

    return await response.json() as PublicProofState;
  } catch { return null; }
}

export function ProofPanel({ base, state, uploadsEnabled = true, onChanged, creditor = "quem cobra" }: {
  base: string; state: ChargeState; uploadsEnabled?: boolean; onChanged?: () => void; creditor?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [status, setStatus] = useState<PublicProofState | null>(null);
  const [preview, setPreview] = useState<ProofPreview | null>(null);
  const [uploaded, setUploaded] = useState<ProofPreview | null>(null);

  useEffect(() => {
    return () => {
      revoke(preview);
    };
  }, [preview]);
  useEffect(() => {
    return () => {
      revoke(uploaded);
    };
  }, [uploaded]);

  function select(next: File | null) {
    setFile(next);
    setPreview(next ? { name: next.name, size: next.size, mime: next.type, url: objectUrl(next) } : null);
  }
  function showStatus(next: PublicProofState) {
    setStatus(next); setError("");

    // A reload lost the local bytes; the slot still names the file, so the card keeps reading.
    if (next.file) {
      setUploaded(previous => previous ?? { name: next.file!.name, size: next.file!.size, mime: next.file!.mime, url: null });
    }
  }

  useEffect(() => { let stopped = false;
    const check = async () => { const started = uploadStarted();
      // A started upload is completed again (falling back to a read); otherwise one read says where the payer's file stands.
      const next = started ? (await completeStatus(base)) ?? (await readStatus(base)) : await readStatus(base);

      if (stopped) {
        return;
      }
      if (!next) { if (started) {
        setError(UNCONFIRMED);
      }

 return; }
      if (started) {
        forgetUpload();
      }
      if (next.state === null) { if (started) {
        setError(NOT_STORED);
      }

 return; }

      showStatus(next);
    };

 void check();

 return () => { stopped = true; };
  }, [base]);

  async function upload() {
    if (!file) {
      return;
    }

    setBusy(true); setError("");

    try {
      if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
        throw new Error("Selecione JPG, PNG ou PDF de até 10 MB.");
      }

      const response = await fetch(`${base}/proof`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }) });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível iniciar o envio."));
      }

      const ticket = await response.json() as ProofUploadTicket;
      const put = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file, credentials: "omit", referrerPolicy: "no-referrer" });

      if (!put.ok) {
        throw new Error("O arquivo não foi enviado. Tente novamente.");
      }

      // The bytes are up: from here only the confirmation can be lost, so a reload completes again instead of offering the dropzone.
      rememberUpload();

      const next = await completeStatus(base);

      if (!next) {
        throw new Error(UNCONFIRMED);
      }

      forgetUpload();

      if (next.state === null) {
        throw new Error(NOT_STORED);
      }

      // The selection becomes the sent file: its thumbnail stays on screen until the creditor answers.
      setUploaded(preview); setPreview(null); setFile(null);
      showStatus(next); onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível enviar o comprovante.");
    } finally { setBusy(false); }
  }
  /** The payer takes the pending file back; the dropzone returns so another one can go up. */
  async function withdraw() {
    setBusy(true); setError("");

    try {
      const response = await fetch(`${base}/proof`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível apagar o comprovante."));
      }

      forgetUpload();
      setStatus(null); setUploaded(null); setSelectionVersion(version => version + 1);
      onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível apagar o comprovante.");
    } finally { setBusy(false); }
  }
  /** The payer already paid and has no file: the charge waits for the creditor, and a file may still follow. */
  async function declare() {
    setBusy(true); setError("");

    try {
      const response = await fetch(`${base}/proof/declaration`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível informar o pagamento."));
      }

      showStatus(await response.json() as PublicProofState);
      onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível informar o pagamento.");
    } finally { setBusy(false); }
  }

  const effectiveState = status?.state === "accepted" ? "paid" : state;
  const declared = status?.state === "pending" && status.kind === ProofKind.Declaration;
  // A declaration keeps the dropzone: the payer may still attach the file.
  const pending = !declared && (status?.state === "pending" || (!uploadsEnabled && status?.state !== "rejected"));
  const rejectedAsDeclaration = status?.state === "rejected" && status.kind === ProofKind.Declaration;
  const rejectedTitle = rejectedAsDeclaration ? "Pagamento não identificado" : "Comprovante rejeitado";
  const rejectedHint = rejectedAsDeclaration ? "informar de novo ou enviar um comprovante." : "enviar outro arquivo.";

  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-outline bg-surface p-4">
      <div className="flex items-center gap-2">
        <Receipt size={20} aria-hidden="true" className="text-primary-strong" />
        <h2 className="m-0 text-base font-bold text-ink">Comprovantes</h2>
      </div>

      {status?.state === "rejected" && (
        <p className={HINT}>
          {rejectedTitle}
          {status.reason ? `: ${status.reason}.` : "."} Você pode {rejectedHint}
        </p>
      )}

      {effectiveState !== "pending" ? (
        <p className={HINT}>Não pague nem envie outro comprovante: esta cobrança está {effectiveState === "paid" ? "paga" : "cancelada"}.</p>
      ) : pending ? (
        <>
          <p role="status" className="m-0 rounded-xl bg-primary-soft/40 p-3 text-sm font-semibold text-primary-strong">
            Comprovante enviado para revisão.
          </p>
          {uploaded && (
            <PreviewCard preview={uploaded}>
              {status?.state === "pending" && (
                <button type="button" disabled={busy} onClick={() => void withdraw()} className={DANGER_BUTTON}>
                  <Trash2 size={16} aria-hidden="true" />
                  Apagar e enviar outro
                </button>
              )}
            </PreviewCard>
          )}
        </>
      ) : (
        <>
          {declared ? (
            <div className="flex flex-col gap-2 rounded-xl bg-primary-soft/40 p-3">
              <p role="status" className="m-0 text-sm font-semibold text-primary-strong">Pagamento informado · aguardando confirmação de {creditor}.</p>
              <button type="button" disabled={busy} onClick={() => void withdraw()} className={DANGER_BUTTON}>
                Desfazer
              </button>
            </div>
          ) : (
            <p className={HINT}>Envie JPG, PNG ou PDF de até 10 MB. O credor confirmará o pagamento após revisar.</p>
          )}
          {preview ? (
            <PreviewCard preview={preview}>
              <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-outline/50 bg-surface px-4 text-sm font-semibold text-ink transition hover:bg-surface-muted has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-primary">
                <CloudUpload size={16} aria-hidden="true" className="text-primary" />
                Trocar arquivo
                <input
                  key={selectionVersion}
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  aria-label={FILE_INPUT_LABEL}
                  disabled={busy}
                  onChange={event => select(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
              </label>
            </PreviewCard>
          ) : (
            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-outline p-5 text-center text-[13.5px] font-semibold text-ink transition hover:border-primary has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-primary md:flex-row md:justify-start md:gap-4 md:p-7 md:text-left">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-primary-soft">
                <CloudUpload size={20} aria-hidden="true" className="text-primary" />
              </span>
              {FILE_INPUT_LABEL}
              <input
                key={selectionVersion}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                aria-label={FILE_INPUT_LABEL}
                disabled={busy}
                onChange={event => select(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
          )}
          <button type="button" disabled={busy || !file} aria-busy={busy} onClick={() => void upload()} className={PRIMARY_BUTTON}>
            {busy && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
            {busy ? "Enviando…" : "Enviar comprovante"}
          </button>
          {!declared && (
            <button type="button" disabled={busy} onClick={() => void declare()} className="self-center text-[12.5px] font-semibold text-primary disabled:opacity-50">
              Já paguei e não tenho comprovante
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
