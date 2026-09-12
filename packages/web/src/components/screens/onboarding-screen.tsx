"use client";

import { formatPhoneBR } from "@receivy/common";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { LegalText } from "@/components/ui/legal-text";
import { browserFetch } from "@/lib/auth/browser-fetch";

type LegalKind = "terms" | "privacy";

type OnboardingScreenProps = {
  /** Where the account was heading before onboarding, e.g. an invite it opened while logged out. */
  nextPath?: string;
  /** What the API already knows: the name a contact owner typed, or the one the OAuth provider sent. */
  initialName?: string | null;
};

const INPUT_CLASS = "h-14 w-full rounded-2xl border border-outline bg-white px-4 text-base text-ink outline-none placeholder:text-muted focus:border-primary";

export function OnboardingScreen({ nextPath = "/", initialName = null }: OnboardingScreenProps = {}) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalKind | null>(null);

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
      // The phone goes as typed (masked); the API normalizes it to its canonical form.
      const response = await browserFetch("/api/financial/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          locale: "pt-BR",
          country: "BR",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!response.ok) {
        throw new Error("profile rejected");
      }

      router.replace(nextPath);
    } catch {
      setError("Não foi possível salvar seus dados. Tente novamente.");
      setBusy(false);
    }
  }

  function toggleLegal(kind: LegalKind) {
    setLegal((current) => (current === kind ? null : kind));
  }

  return (
    <div className="mx-auto w-full max-w-md md:max-w-lg">
      <section aria-labelledby="onboarding-title" className="rounded-3xl border border-outline/60 bg-surface p-6 md:p-8">
        <p className="m-0 text-xs font-extrabold uppercase tracking-widest text-primary">Antes de começar</p>
        <h1 id="onboarding-title" className="m-0 mt-3 text-3xl font-extrabold leading-9 tracking-tight text-primary-strong">
          Como podemos chamar você?
        </h1>
        <p className="m-0 mt-3 text-sm leading-6 text-muted">Esse nome aparece para quem recebe suas cobranças e lembretes.</p>

        <form onSubmit={submit}>
          <label htmlFor="onboarding-name" className="mb-2 mt-7 block text-sm font-bold text-ink">
            Nome
          </label>
          <input
            id="onboarding-name"
            autoComplete="name"
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome"
            required
            value={name}
            className={INPUT_CLASS}
          />

          <label htmlFor="onboarding-phone" className="mb-2 mt-5 block text-sm font-bold text-ink">
            Telefone (Opcional)
          </label>
          <input
            id="onboarding-phone"
            type="text"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            onChange={(event) => setPhone(formatPhoneBR(event.target.value))}
            placeholder="(11) 98765-4321"
            value={phone}
            aria-describedby="onboarding-phone-hint"
            className={INPUT_CLASS}
          />

          <button type="submit" disabled={!canContinue} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-white transition active:opacity-80 disabled:opacity-50">
            Continuar
            {busy && <Loader2 aria-hidden="true" size={18} className="animate-spin" />}
          </button>
        </form>

        {error && (
          <p role="alert" className="m-0 mt-4 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
            {error}
          </p>
        )}
      </section>

      <p className="m-0 mt-6 text-center text-xs leading-5 text-muted">
        Ao continuar, você concorda com os{" "}
        <button type="button" onClick={() => toggleLegal("terms")} className="font-bold text-primary">
          Termos de uso
        </button>{" "}
        e a{" "}
        <button type="button" onClick={() => toggleLegal("privacy")} className="font-bold text-primary">
          Privacidade
        </button>
        .
      </p>

      {legal && (
        <div className="mt-6">
          <LegalText kind={legal} />
        </div>
      )}
    </div>
  );
}
