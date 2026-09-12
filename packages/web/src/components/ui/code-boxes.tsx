"use client";

import { useState } from "react";

export const CODE_LENGTH = 6;

type CodeBoxesProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * Six visual boxes backed by one real input, so paste, autofill from SMS/e-mail and
 * screen readers keep working. The input sits over the boxes with zero opacity.
 */
export function CodeBoxes({ value, onChange, disabled = false, autoFocus = true }: CodeBoxesProps) {
  const [focused, setFocused] = useState(false);

  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? "");
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className="relative">
      <div className="flex justify-between gap-2" aria-hidden="true">
        {digits.map((digit, index) => {
          const active = focused && index === activeIndex;

          return (
            <div key={index} className={`relative flex h-16 flex-1 items-center justify-center rounded-2xl border bg-surface ${active ? "border-2 border-primary" : "border-outline"}`}>
              <span className="text-2xl font-extrabold text-ink">{digit}</span>
              {active && digit === "" && <span className="absolute h-7 w-0.5 bg-ink" />}
            </div>
          );
        })}
      </div>
      <input
        id="login-code"
        aria-label="Código de 6 dígitos"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        inputMode="numeric"
        maxLength={CODE_LENGTH}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        value={value}
        className="absolute inset-0 h-full w-full border-0 bg-transparent text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  );
}
