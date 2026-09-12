"use client";

import type { SplitMode } from "@receivy/common";
import { initialOf } from "./contact-carousel";

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

export function SplitEditor({ mode, rows, hint, disabled, onChange }: SplitEditorProps) {
  return (
    <div className="split-editor">
      <ul className="split-rows">
        {rows.map(row => {
          if (row.readonlyText) {
            return (
              <li key={row.key} className="split-row split-row--readonly">
                <span className="split-name">{row.readonlyText}</span>
              </li>
            );
          }

          return (
            <li key={row.key} className="split-row">
              <span className="contact-avatar" aria-hidden="true">{initialOf(row.name)}</span>
              <span className="split-name">{row.name}</span>
              {mode !== "equal" && (
                <input
                  className="split-input"
                  aria-label={`${FIELD_LABELS[mode]} de ${row.name}`}
                  inputMode={mode === "shares" ? "numeric" : "decimal"}
                  disabled={disabled}
                  value={row.value}
                  onChange={event => onChange(row.key, event.target.value)}
                />
              )}
              {row.amountText && <span className="split-amount">{row.amountText}</span>}
            </li>
          );
        })}
      </ul>
      {hint && <p className="split-hint">{hint}</p>}
    </div>
  );
}
