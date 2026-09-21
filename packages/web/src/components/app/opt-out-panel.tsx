"use client";

import { useState } from "react";

type OptOutPanelProps = { token: string; optedOut: boolean };

const OPTED_OUT_TEXT = "Você não recebe mais e-mails de cobrança. Quem te cobra ainda pode te mandar o link direto.";
const REVERTED_TEXT = "Você voltou a receber e-mails de cobrança.";
const ERROR_TEXT = "Não foi possível alterar. Tente de novo pelo link do e-mail.";

/** The e-mail footer's landing panel: confirms opt-out and lets the person opt back in. One-directional — opting out again means opening the link from another e-mail. */
export function OptOutPanel({ token, optedOut: initialOptedOut }: OptOutPanelProps) {
  const [optedOut, setOptedOut] = useState(initialOptedOut);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function optBackIn() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/public/opt-out/${token}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error("opt-in failed");
      }

      setOptedOut(false);
    } catch {
      setError(ERROR_TEXT);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm leading-6 text-muted">{optedOut ? OPTED_OUT_TEXT : REVERTED_TEXT}</p>

      {optedOut && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void optBackIn()}
          className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-xl bg-primary px-5 text-[15px] font-bold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
        >
          Voltar a receber
        </button>
      )}

      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
