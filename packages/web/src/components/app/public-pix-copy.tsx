"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type PublicPixCopyProps = { pixKey: string; timeoutMs?: number };

const COPIED_MS = 3_000;

/** The payer's copy button: confirms inline as "Chave copiada" for a few seconds, like the app's CopyButton. */
export function PublicPixCopy({ pixKey, timeoutMs = 2_000 }: PublicPixCopyProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  function legacyCopy(): boolean {
    if (typeof document.execCommand !== "function") {
      return false;
    }

    const input = document.createElement("textarea");

    input.value = pixKey;
    input.readOnly = true;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      input.remove();
    }
  }

  async function copy() {
    setBusy(true);
    setError("");

    try {
      if (!legacyCopy()) {
        if (!navigator.clipboard?.writeText) {
          throw new Error("clipboard unavailable");
        }

        await Promise.race([navigator.clipboard.writeText(pixKey), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("clipboard timeout")), timeoutMs))]);
      }

      setCopied(true);

      if (timer.current) {
        clearTimeout(timer.current);
      }

      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setError("Não foi possível copiar. Selecione a chave e copie manualmente.");
    } finally {
      setBusy(false);
    }
  }

  const Icon = copied ? Check : Copy;
  const label = busy ? "Copiando…" : copied ? "Chave copiada" : "Copiar chave Pix";

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={busy ? "Copiando chave Pix" : "Copiar chave Pix"}
        aria-pressed={copied}
        onClick={() => void copy()}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-outline/50 bg-surface px-4 text-sm font-bold text-primary transition hover:bg-surface-muted disabled:opacity-50"
      >
        <Icon size={16} aria-hidden="true" />
        {label}
      </button>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
