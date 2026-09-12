"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canContinue = !busy && trimmedName.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canContinue) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await browserFetch("/api/financial/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          locale: "pt-BR",
          country: "BR",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!response.ok) {
        throw new Error("profile rejected");
      }

      router.replace("/");
    } catch {
      setError("Não foi possível salvar seu nome. Tente novamente.");
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="onboarding-name">Nome</label>
      <div className="login-input-shell">
        <input
          id="onboarding-name"
          autoComplete="name"
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Seu nome"
          required
          value={name}
        />
      </div>
      <button className="login-submit" type="submit" disabled={!canContinue}>
        {busy ? "Salvando…" : "Continuar"}
        <ArrowRight aria-hidden="true" size={18} />
      </button>
      {error && <p className="login-error" role="alert">{error}</p>}
    </form>
  );
}
