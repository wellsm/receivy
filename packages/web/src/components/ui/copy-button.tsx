"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CopyButtonProps = {
  value: string;
  label?: string;
  /** Accessible name; defaults to the visible label. */
  ariaLabel?: string;
  /** `link` is the small inline action; `outline` the bordered button of a list. */
  variant?: "link" | "outline";
  /** Called when the clipboard refuses the write; the button then stays on its idle label. */
  onRefused?: () => void;
};

const COPIED_MS = 3_000;

/** Copies `value` and confirms inline as "Copiado" for a few seconds before returning to its label. */
export function CopyButton({ value, label = "Copiar", ariaLabel, variant = "link", onRefused }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      onRefused?.();

      return;
    }

    setCopied(true);

    if (timer.current) {
      clearTimeout(timer.current);
    }

    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  const outline = variant === "outline";
  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-pressed={copied}
      onClick={() => void copy()}
      className={
        outline
          ? "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-outline/40 bg-surface px-3 text-xs font-semibold text-primary"
          : "inline-flex min-h-8 items-center gap-1 pl-2 text-[11px] font-semibold text-primary"
      }
    >
      <Icon size={outline ? 14 : 13} aria-hidden="true" />
      {copied ? "Copiado" : label}
    </button>
  );
}
