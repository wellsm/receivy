"use client";

import type { SplitMode } from "@receivy/common";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

export type SplitRow = {
  key: string;
  name: string;
  value: string;
  amountText: string;
  /** Set on a row the user cannot edit, such as the owner's remainder on a fixed split. */
  readonlyText?: string;
};

type SplitEditorProps = {
  mode: SplitMode;
  rows: SplitRow[];
  hint: string;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
};

const FIELD_LABELS: Record<Exclude<SplitMode, "equal">, string> = {
  shares: "Cotas",
  fixed: "Valor",
  percentage: "Porcentagem",
};

const FIELD_SUFFIX: Record<Exclude<SplitMode, "equal">, string> = {
  shares: "cota(s)",
  fixed: "",
  percentage: "%",
};

export function SplitEditor({ mode, rows, hint, disabled, onChange }: SplitEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map(row => {
          if (row.readonlyText) {
            return (
              <li key={row.key} className="flex min-h-12 items-center rounded-xl border border-outline/20 bg-surface-muted/60 px-3 py-2">
                <span className="flex-1 text-sm font-semibold text-primary-strong">{row.readonlyText}</span>
              </li>
            );
          }

          return (
            <li key={row.key} className="flex min-h-12 items-center gap-2 rounded-xl border border-outline/20 bg-surface-muted/60 px-2.5 py-2">
              <InitialsAvatar name={row.name} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{row.name}</span>
              {mode !== "equal" && (
                <span className="flex items-center gap-1">
                  <input
                    className={`h-9 rounded-lg border border-outline/40 bg-surface px-2 text-right text-[13px] font-bold text-primary-strong ${mode === "fixed" ? "w-24" : "w-14"}`}
                    aria-label={`${FIELD_LABELS[mode]} de ${row.name}`}
                    inputMode={mode === "shares" ? "numeric" : "decimal"}
                    placeholder={mode === "shares" ? "1" : "0"}
                    disabled={disabled}
                    value={row.value}
                    onChange={event => onChange(row.key, event.target.value)}
                  />
                  {FIELD_SUFFIX[mode] && <span className="text-xs text-muted">{FIELD_SUFFIX[mode]}</span>}
                </span>
              )}
              {row.amountText && <span className="text-sm font-bold text-primary">{row.amountText}</span>}
            </li>
          );
        })}
      </ul>
      {hint && <p className="m-0 text-sm font-semibold text-warning">{hint}</p>}
    </div>
  );
}
