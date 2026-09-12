"use client";

import { canMarkPaid, canUploadProof, fileSizeText, momentText, proofNote, proofStateLabel, type ChargeDetail } from "@receivy/common";
import { Check, CloudUpload, Eye, FileText, Image as ImageIcon, Receipt } from "lucide-react";
import { useRef } from "react";
import { PROOF_ACCEPT } from "@/lib/proof-upload";
import { StatusTag } from "@/components/ui/status-tag";

type ProofCardProps = {
  charge: ChargeDetail;
  busy: boolean;
  onView: () => void;
  onUpload: (file: File) => void;
  onAccept: () => void;
};

function FilePicker({ label, disabled, onPick }: { label: string; disabled: boolean; onPick: (file: File) => void }) {
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
        className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-outline/60 bg-surface-muted/50 px-4 text-sm font-semibold text-ink transition hover:border-primary disabled:opacity-50"
      >
        <CloudUpload size={20} aria-hidden="true" className="text-primary" />
        {label}
      </button>
    </>
  );
}

/** The proof section of a charge: the file with "Ver", plus accept (creditor) or replace (debtor) when allowed. */
export function ProofCard({ charge, busy, onView, onUpload, onAccept }: ProofCardProps) {
  const proof = charge.proof;
  const upload = canUploadProof(charge);
  // Whoever collects settles from here: accepting the file under review, or by hand when there is none to accept.
  const settle = canMarkPaid(charge);
  const replace = useRef<HTMLInputElement>(null);

  if (!proof) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4">
        <div className="flex items-center gap-2">
          <Receipt size={20} aria-hidden="true" className="text-primary-strong" />
          <h2 className="m-0 text-base font-bold text-ink">Comprovante</h2>
        </div>

        {upload ? (
          <>
            <FilePicker label="Enviar comprovante" disabled={busy} onPick={onUpload} />
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
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-white transition hover:bg-primary-strong disabled:opacity-50"
          >
            <Check size={16} aria-hidden="true" />
            Marcar como pago
          </button>
        )}
      </section>
    );
  }

  const state = proofStateLabel(proof);
  const note = proofNote(charge);
  const FileIcon = proof.file.mime === "application/pdf" ? FileText : ImageIcon;

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
          <p className="m-0 truncate text-sm font-semibold text-ink">{proof.file.name}</p>
          <p className="m-0 text-[11px] text-muted">
            {fileSizeText(proof.file.size)} • Enviado em {momentText(proof.sentAt)}
          </p>
        </div>
      </div>

      {note && <p className="m-0 text-xs leading-4 text-muted">{note}</p>}

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

        {settle && (
          <button
            type="button"
            aria-label="Marcar como pago"
            disabled={busy}
            onClick={onAccept}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-white transition hover:bg-primary-strong disabled:opacity-50"
          >
            <Check size={16} aria-hidden="true" />
            Marcar como pago
          </button>
        )}

        {upload && (
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
                  onUpload(file);
                }
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => replace.current?.click()}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-xs font-semibold text-white transition hover:bg-primary-strong disabled:opacity-50"
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
