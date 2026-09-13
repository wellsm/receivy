"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

type ConfirmDialogProps = {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** Optional boxed detail between the header and the explanation. */
  detail?: ReactNode;
  explanation?: string;
  confirmLabel: string;
  /** "danger" for irreversible actions (default); "primary" for confirmations that only move the flow forward. */
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const TONE_STYLES = {
  danger: {
    badge: "bg-danger-soft text-danger",
    confirm: "bg-danger-solid",
    confirmText: "text-on-primary",
  },
  primary: {
    badge: "bg-primary-soft text-primary-strong",
    confirm: "bg-primary hover:bg-primary-strong",
    confirmText: "text-on-primary",
  },
} as const;

/** The confirmation used by "Encerrar", "Excluir chave", "Remover contato" and, in the primary tone, "Marcar paga". */
export function ConfirmDialog({ title, subtitle, icon: Icon, detail, explanation, confirmLabel, tone = "danger", busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  const styles = TONE_STYLES[tone];

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-scrim px-4"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-outline/30 bg-surface p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${styles.badge}`}>
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="m-0 text-[17px] font-bold text-ink">
              {title}
            </h2>
            {subtitle && <p className="m-0 text-[11px] text-muted">{subtitle}</p>}
          </div>
        </div>
        {detail && <div className="flex flex-col gap-1 rounded-xl border border-outline/30 bg-surface-muted/70 p-3">{detail}</div>}
        {explanation && <p className="m-0 text-xs leading-5 text-muted">{explanation}</p>}
        <div className="flex gap-2.5 pt-1">
          <button ref={cancel} type="button" onClick={onCancel} className="h-11 flex-1 rounded-xl border border-outline/50 bg-surface text-sm font-semibold text-ink">
            Cancelar
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className={`h-11 flex-1 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${styles.confirm} ${styles.confirmText}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
