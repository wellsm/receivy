"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";

type ScopeDialogProps = {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  explanation: string;
  primaryLabel: string;
  secondaryLabel: string;
  /** "danger" when the second action cancels charges; "neutral" when it only narrows the scope. */
  secondaryTone?: "danger" | "neutral";
  busy?: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onCancel: () => void;
};

const SECONDARY_STYLES = {
  danger: "bg-danger-solid text-on-primary",
  neutral: "border border-outline/50 bg-surface text-ink",
} as const;

/** A choice with two outcomes plus Voltar: Pausar, Encerrar and the scope of a recorrente edit. */
export function ScopeDialog({ title, subtitle, icon: Icon, explanation, primaryLabel, secondaryLabel, secondaryTone = "neutral", busy = false, onPrimary, onSecondary, onCancel }: ScopeDialogProps) {
  const back = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    back.current?.focus();
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
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-outline/30 bg-surface p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
            <Icon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-[17px] font-bold text-ink">
              {title}
            </h2>
            {subtitle && <p className="m-0 text-[11px] text-muted">{subtitle}</p>}
          </div>
        </div>
        <p className="m-0 text-xs leading-5 text-muted">{explanation}</p>
        <div className="flex flex-col gap-2.5 pt-1">
          <button type="button" disabled={busy} onClick={onPrimary} className="h-11 rounded-xl bg-primary text-sm font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50">
            {primaryLabel}
          </button>
          <button type="button" disabled={busy} onClick={onSecondary} className={`h-11 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${SECONDARY_STYLES[secondaryTone]}`}>
            {secondaryLabel}
          </button>
          <button ref={back} type="button" onClick={onCancel} className="h-11 rounded-xl text-sm font-semibold text-muted">
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
