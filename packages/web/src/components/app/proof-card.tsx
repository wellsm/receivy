"use client";

import { canAcceptProof, canDeclarePayment, canMarkPaid, canUploadProof, canWithdrawProof, fileSizeText, momentText, proofNote, proofStateLabel, ProofKind, ProofState, type ChargeDetail } from "@receivy/common";
import { Check, CloudUpload, Eye, FileText, Image as ImageIcon, Loader2, Receipt } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROOF_ACCEPT } from "@/lib/proof-upload";
import { StatusTag } from "@/components/ui/status-tag";

const DROPZONE =
  "flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline/60 bg-surface-muted/50 px-4 text-sm font-semibold text-ink transition hover:border-primary disabled:opacity-50";
const OUTLINE_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-outline/50 text-xs font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-50";
const PRIMARY_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50";

type ProofCardProps = {
  charge: ChargeDetail;
  busy: boolean;
  /** True from the send click until the upload is completed, so the send button reads as in flight. */
  sending?: boolean;
  /** The staged file, previewed in the card until it is sent. */
  picked: File | null;
  onView: () => void;
  /** Staging only: picking a file never sends it, the send button does. */
  onPick: (file: File) => void;
  /** Only when the screen has no footer to send from (the owner who also settles). */
  onSend?: () => void;
  onAccept: () => void;
  /** The paying side says it already paid, without a file. */
  onDeclare?: () => void;
  /** The sender takes back what nobody answered yet. */
  onWithdraw?: () => void;
  /** Whoever collects says the declared payment did not arrive. */
  onReject?: () => void;
};

function FilePicker({ label, disabled, onPick, className = DROPZONE }: { label: string; disabled: boolean; onPick: (file: File) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PROOF_ACCEPT}
        aria-label="Comprovante JPG, PNG ou PDF"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];

          event.target.value = "";

          if (file) {
            onPick(file);
          }
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className={className}
      >
        <CloudUpload size={20} aria-hidden="true" className="text-primary" />
        {label}
      </button>
    </>
  );
}

/** The picked file before it goes up: a thumbnail for an image, a document mark otherwise. */
function PickedPreview({ file, url, busy, sending, onPick, onSend }: { file: File; url: string | null; busy: boolean; sending?: boolean; onPick: (file: File) => void; onSend?: () => void }) {
  const FileIcon = file.type === "application/pdf" ? FileText : ImageIcon;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-outline/30 bg-surface-muted/50 p-3">
      {url ? (
        // A blob URL from the viewer's own device: nothing for next/image to optimise or serve.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Prévia de ${file.name}`} className="max-h-56 w-full rounded-lg object-contain" />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg bg-surface">
          <FileIcon size={32} aria-hidden="true" className="text-primary" />
        </div>
      )}

      <p className="m-0 flex min-w-0 gap-1 text-sm">
        <span className="min-w-0 truncate font-semibold text-ink">{file.name}</span>
        <span className="shrink-0 text-muted">· {fileSizeText(file.size)}</span>
      </p>

      <div className="flex gap-2">
        <FilePicker
          label="Trocar arquivo"
          disabled={busy}
          onPick={onPick}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-outline/50 bg-surface text-xs font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-50"
        />

        {onSend && (
          <button
            type="button"
            disabled={busy}
            aria-busy={sending}
            onClick={onSend}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
          >
            {sending ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <CloudUpload size={16} aria-hidden="true" />}
            {sending ? "Enviando…" : "Enviar comprovante"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The proof section of a charge: the file with "Ver", plus accept (creditor) or replace (debtor) when allowed. */
export function ProofCard({ charge, busy, sending, picked, onView, onPick, onSend, onAccept, onDeclare, onWithdraw, onReject }: ProofCardProps) {
  const proof = charge.proof;
  const upload = canUploadProof(charge);
  // Whoever collects settles from here: accepting the file under review, or by hand when there is none to accept.
  const settle = canMarkPaid(charge);
  const declare = canDeclarePayment(charge) && !!onDeclare;
  const replace = useRef<HTMLInputElement>(null);
  // Created when the file is picked, released when the next one replaces it or the card goes away.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function pick(file: File) {
    const image = file.type.startsWith("image/") && typeof URL.createObjectURL === "function";

    setPreviewUrl(image ? URL.createObjectURL(file) : null);
    onPick(file);
  }

  if (!proof) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
        <div className="flex items-center gap-2">
          <Receipt size={20} aria-hidden="true" className="text-primary-strong" />
          <h2 className="m-0 text-base font-bold text-ink">Comprovante</h2>
        </div>

        {upload ? (
          <>
            {picked ? <PickedPreview file={picked} url={previewUrl} busy={busy} sending={sending} onPick={pick} onSend={onSend} /> : <FilePicker label="Selecionar comprovante" disabled={busy} onPick={pick} />}
            <p className="m-0 text-[11px] text-muted">JPG, PNG ou PDF de até 10 MB.</p>
          </>
        ) : (
          <p className="m-0 text-sm text-muted">Nenhum comprovante enviado.</p>
        )}

        {settle && (
          <button
            type="button"
            aria-label="Marcar como pago"
            disabled={busy}
            onClick={onAccept}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
          >
            <Check size={16} aria-hidden="true" />
            Marcar como pago
          </button>
        )}

        {declare && (
          <button type="button" disabled={busy} onClick={onDeclare} className={OUTLINE_BUTTON}>
            <Check size={16} aria-hidden="true" />
            Já paguei
          </button>
        )}
      </section>
    );
  }

  if (proof.kind === ProofKind.Declaration) {
    const state = proofStateLabel(proof);
    const note = proofNote(charge);
    const answer = canAcceptProof(charge);
    const withdraw = canWithdrawProof(charge) && !!onWithdraw;
    const sent = momentText(proof.sentAt);
    const waiting = proof.state === ProofState.Pending;
    const line = proof.sentByViewer
      ? `Informado em ${sent}${waiting ? ` · aguardando confirmação de ${charge.counterpartName}` : ""}`
      : `${charge.counterpartName} informou que pagou em ${sent}, sem comprovante`;

    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt size={20} aria-hidden="true" className="text-primary-strong" />
            <h2 className="m-0 text-base font-bold text-ink">Pagamento informado</h2>
          </div>
          <StatusTag label={state.label} tone={state.tone} />
        </div>

        <p className="m-0 text-sm leading-5 text-ink">{line}</p>

        {note && <p className="m-0 text-xs leading-4 text-muted">{note}</p>}

        {upload && picked && <PickedPreview file={picked} url={previewUrl} busy={busy} sending={sending} onPick={pick} onSend={onSend} />}

        <div className="flex flex-wrap gap-2">
          {withdraw && (
            <button type="button" disabled={busy} onClick={onWithdraw} className={OUTLINE_BUTTON}>
              Desfazer
            </button>
          )}
          {declare && (
            <button type="button" disabled={busy} onClick={onDeclare} className={OUTLINE_BUTTON}>
              Informar de novo
            </button>
          )}
          {upload && !picked && <FilePicker label="Anexar comprovante" disabled={busy} onPick={pick} className={PRIMARY_BUTTON} />}
          {answer && onReject && (
            <button type="button" disabled={busy} onClick={onReject} className={OUTLINE_BUTTON}>
              Não recebi
            </button>
          )}
          {answer && (
            <button type="button" disabled={busy} onClick={onAccept} className={PRIMARY_BUTTON}>
              <Check size={16} aria-hidden="true" />
              Confirmar recebimento
            </button>
          )}
          {settle && !answer && (
            <button type="button" aria-label="Marcar como pago" disabled={busy} onClick={onAccept} className={PRIMARY_BUTTON}>
              <Check size={16} aria-hidden="true" />
              Marcar como pago
            </button>
          )}
        </div>
      </section>
    );
  }

  const state = proofStateLabel(proof);
  const note = proofNote(charge);
  const FileIcon = proof.file!.mime === "application/pdf" ? FileText : ImageIcon;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Receipt size={20} aria-hidden="true" className="text-primary-strong" />
          <h2 className="m-0 text-base font-bold text-ink">Comprovante</h2>
        </div>
        <StatusTag label={state.label} tone={state.tone} />
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-outline/30 bg-surface-muted p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-primary-strong">
          <FileIcon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-semibold text-ink">{proof.file!.name}</p>
          <p className="m-0 text-[11px] text-muted">
            {fileSizeText(proof.file!.size)} • Enviado em {momentText(proof.sentAt)}
          </p>
        </div>
      </div>

      {note && <p className="m-0 text-xs leading-4 text-muted">{note}</p>}

      {upload && picked && <PickedPreview file={picked} url={previewUrl} busy={busy} sending={sending} onPick={pick} onSend={onSend} />}

      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Ver comprovante"
          disabled={busy}
          onClick={onView}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-outline/50 text-xs font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-50"
        >
          <Eye size={16} aria-hidden="true" className="text-primary-strong" />
          Ver comprovante
        </button>

        {declare && (
          <button type="button" disabled={busy} onClick={onDeclare} className={OUTLINE_BUTTON}>
            Já paguei
          </button>
        )}

        {settle && (
          <button
            type="button"
            aria-label="Marcar como pago"
            disabled={busy}
            onClick={onAccept}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
          >
            <Check size={16} aria-hidden="true" />
            Marcar como pago
          </button>
        )}

        {upload && !picked && (
          <>
            <input
              ref={replace}
              type="file"
              accept={PROOF_ACCEPT}
              aria-label="Substituir comprovante"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];

                event.target.value = "";

                if (file) {
                  pick(file);
                }
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => replace.current?.click()}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
            >
              <CloudUpload size={16} aria-hidden="true" />
              Substituir
            </button>
          </>
        )}
      </div>
    </section>
  );
}
