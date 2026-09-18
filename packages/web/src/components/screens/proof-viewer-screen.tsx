"use client";

import { canAcceptProof, canUploadProof, canWithdrawProof, fileSizeText, momentText, proofNote, proofStateLabel, type ChargeDetail } from "@receivy/common";
import { Check, CloudUpload, ExternalLink, FileText, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { PROOF_ACCEPT, uploadProofFile } from "@/lib/proof-upload";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScreenFooter } from "@/components/ui/screen-footer";
import { StatusTag } from "@/components/ui/status-tag";

const LOAD_ERROR = "Não foi possível carregar o comprovante.";

async function request<T>(path: string, init: RequestInit = {}, fallback = LOAD_ERROR): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Full view of the proof on a charge: the creditor settles it here, the debtor replaces a rejected one or takes back a pending one. */
export function ProofViewerScreen({ chargeId }: { chargeId: string }) {
  const router = useRouter();
  const [charge, setCharge] = useState<ChargeDetail | null>(null);
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const base = `/api/financial/charges/${chargeId}`;

  const downloadUrl = useCallback(
    async () => (await request<{ url: string }>(`${base}/proof/download`, {}, "Não foi possível baixar o comprovante.")).url,
    [base],
  );

  const load = useCallback(() => {
    let live = true;

    request<ChargeDetail>(base)
      .then(async (detail) => {
        // The download link is signed and short-lived, so it is fetched together with the file it shows.
        const link = detail.proof ? await downloadUrl() : "";

        if (!live) {
          return;
        }

        setCharge(detail);
        setUrl(link);
        setError("");
      })
      .catch((failure: unknown) => live && setError(failure instanceof Error ? failure.message : LOAD_ERROR))
      .finally(() => live && setLoaded(true));

    return () => {
      live = false;
    };
  }, [base, downloadUrl]);

  useEffect(() => load(), [load]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");

    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function review(decision: "accepted" | "rejected") {
    setConfirmAccept(false);

    await run(async () => {
      const body = {
        decision,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };

      await request<ChargeDetail>(
        `${base}/proof/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        "Não foi possível revisar o comprovante.",
      );

      router.push(`/charges/${chargeId}`);
    }, "Não foi possível revisar o comprovante.");
  }

  async function replace(file: File) {
    await run(async () => {
      const sent = await uploadProofFile(base, file);

      setCharge(sent);
      setUrl(await downloadUrl());
    }, "Não foi possível enviar o comprovante.");
  }

  /** The sender takes back a file nobody reviewed yet; the charge is where the next one goes up. */
  async function withdraw() {
    await run(async () => {
      await request<void>(`${base}/proof`, { method: "DELETE" }, "Não foi possível apagar o comprovante.");

      router.push(`/charges/${chargeId}`);
    }, "Não foi possível apagar o comprovante.");
  }

  if (!loaded) {
    return (
      <p role="status" className="m-0 text-sm text-muted">
        Carregando comprovante…
      </p>
    );
  }

  if (!charge?.proof) {
    return (
      <section className="flex flex-col gap-3">
        <p role={error ? "alert" : undefined} className="m-0 text-center text-muted">
          {error || "Nenhum comprovante enviado."}
        </p>
        {error && (
          <button type="button" className="min-h-12 font-bold text-primary" onClick={load}>
            Tentar novamente
          </button>
        )}
      </section>
    );
  }

  const proof = charge.proof;

  if (!proof.file) {
    // A declaration has no file to show here; its own view comes in a later task.
    return null;
  }

  const state = proofStateLabel(proof);
  const note = proofNote(charge);
  const accept = canAcceptProof(charge);
  const replaceAllowed = canUploadProof(charge);
  const withdrawAllowed = canWithdrawProof(charge);
  const isPdf = proof.file.mime === "application/pdf";

  return (
    <section className="flex flex-col gap-4 pb-4">
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)] md:items-start">
        <article className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 truncate text-base font-bold text-ink">{proof.file.name}</h2>
              <p className="m-0 text-[11px] text-muted">
                {fileSizeText(proof.file.size)} • Enviado em {momentText(proof.sentAt)}
              </p>
            </div>
            <StatusTag label={state.label} tone={state.tone} />
          </div>

          {isPdf ? (
            <iframe title={`Comprovante ${proof.file.name}`} src={url} className="h-[70vh] w-full rounded-xl border border-outline/30 bg-surface-muted" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL from the storage provider
            <img src={url} alt={`Comprovante ${proof.file.name}`} className="max-h-[70vh] w-full rounded-xl bg-surface-muted object-contain" />
          )}

          <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 self-start text-xs font-semibold text-primary">
            <ExternalLink size={14} aria-hidden="true" />
            Abrir em nova aba
          </a>

          {note && <p className="m-0 text-xs leading-4 text-muted">{note}</p>}
        </article>

        <div className="flex flex-col gap-4">
          {accept && (
            <article className="flex flex-col gap-2 rounded-2xl border border-outline/30 bg-surface p-4">
              <label htmlFor="proof-reason" className="text-sm font-semibold text-ink">
                Motivo (opcional)
              </label>
              <input
                id="proof-reason"
                maxLength={500}
                value={reason}
                placeholder="Usado apenas se você rejeitar"
                onChange={(event) => setReason(event.target.value)}
                className="min-h-12 rounded-xl border border-outline/50 bg-surface px-3 text-[15px] text-ink"
              />
            </article>
          )}

          {!isPdf && (
            <article className="flex items-center gap-3 rounded-2xl border border-outline/30 bg-surface p-4 text-xs text-muted">
              <FileText size={18} aria-hidden="true" className="shrink-0 text-primary-strong" />
              Confira valor, data e destinatário antes de decidir.
            </article>
          )}
        </div>
      </div>

      {(accept || replaceAllowed || withdrawAllowed) && (
        <ScreenFooter className="-mx-1 mt-2 flex gap-2 border-t border-outline/20 bg-canvas/95 px-1 py-3 backdrop-blur-md">
          {accept && (
            <>
              <button
                type="button"
                aria-label="Rejeitar comprovante"
                disabled={busy}
                onClick={() => void review("rejected")}
                className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-xl border border-outline/50 bg-surface text-sm font-bold text-danger disabled:opacity-50"
              >
                <X size={18} aria-hidden="true" />
                Rejeitar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmAccept(true)}
                className="flex h-[52px] flex-[2] items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
              >
                <Check size={18} aria-hidden="true" />
                Marcar como pago
              </button>
            </>
          )}

          {replaceAllowed && (
            <>
              <input
                ref={picker}
                type="file"
                accept={PROOF_ACCEPT}
                aria-label="Enviar novo comprovante"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  event.target.value = "";

                  if (file) {
                    void replace(file);
                  }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => picker.current?.click()}
                className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
              >
                <CloudUpload size={18} aria-hidden="true" />
                Enviar novo comprovante
              </button>
            </>
          )}

          {withdrawAllowed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void withdraw()}
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-xl border border-danger/30 bg-surface text-sm font-bold text-danger transition hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash2 size={18} aria-hidden="true" />
              Apagar e enviar outro
            </button>
          )}
        </ScreenFooter>
      )}

      {confirmAccept && (
        <ConfirmDialog
          title="Marcar como pago?"
          icon={Check}
          tone="primary"
          explanation="Isso aceita o comprovante e registra o pagamento integral. Dá para reabrir depois."
          confirmLabel="Marcar pago"
          busy={busy}
          onConfirm={() => void review("accepted")}
          onCancel={() => setConfirmAccept(false)}
        />
      )}
    </section>
  );
}
