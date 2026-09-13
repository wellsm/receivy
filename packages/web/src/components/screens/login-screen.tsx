"use client";

import { Apple, ArrowRight, Loader2, Mail } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { GoogleMark } from "@/components/app/brand-marks";
import type { LoginProviders } from "@/lib/auth/login-providers";
import { isProviderAuthorizationUrl } from "@/lib/auth/oauth";
import { writePendingLogin } from "@/lib/auth/pending-login";
import { responseMessage } from "@/lib/financial-response";

type LoginScreenProps = {
  nextPath: string;
  /** Resolved on the server so the browser never asks the API which providers are on. */
  providers: LoginProviders;
  oauthError?: boolean;
};

const SOCIAL_BUTTON = "flex h-14 w-full items-center justify-center gap-3 rounded-2xl text-base font-bold transition active:opacity-80 disabled:opacity-40";

export function LoginScreen({ nextPath, providers, oauthError = false }: LoginScreenProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? "Não foi possível concluir o login. Tente novamente ou use seu e-mail." : null);

  async function socialLogin(provider: "google" | "apple") {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      if (!response.ok) {
        throw new Error();
      }

      const { authorizationUrl } = await response.json();

      if (!isProviderAuthorizationUrl(authorizationUrl, provider)) {
        throw new Error();
      }

      window.location.assign(authorizationUrl);
    } catch {
      setError("Não foi possível concluir o login. Tente novamente ou use seu e-mail.");
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        setError(await responseMessage(response, "Não foi possível enviar o código agora."));
        setBusy(false);
        return;
      }

      writePendingLogin({ email, sentAt: Date.now(), nextPath });
      // Left busy on purpose: the route change unmounts this screen, and clearing it here
      // would flash the button back to idle while the old screen is still on top.
      router.push("/login/code");
    } catch {
      setError("Não foi possível enviar o código agora.");
      setBusy(false);
    }
  }

  const hasSocial = providers.google || providers.apple;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 md:max-w-lg">
      <div className="flex flex-col items-center text-center">
        <Image src="/brand-icon.png" alt="" width={96} height={96} priority className="h-24 w-24 rounded-3xl shadow-[0_8px_16px_rgba(0,56,40,0.25)]" />
        <h1 className="m-0 mt-5 text-4xl font-extrabold tracking-tight text-primary-strong md:text-5xl">Receivy</h1>
        <p className="m-0 mt-2 text-base text-muted md:text-lg">Controle o que tem a receber e a pagar</p>
      </div>

      <div>
        <div className="flex flex-col gap-3 rounded-3xl border border-outline/60 bg-surface p-5 md:p-7">
          {providers.google && (
            <button type="button" disabled={busy} onClick={() => void socialLogin("google")} className={`${SOCIAL_BUTTON} border border-outline bg-surface text-ink hover:bg-surface-muted`}>
              <GoogleMark />
              Continuar com Google
            </button>
          )}

          {providers.apple && (
            <button type="button" disabled={busy} onClick={() => void socialLogin("apple")} className={`${SOCIAL_BUTTON} bg-black text-white`}>
              <Apple aria-hidden="true" size={20} />
              Continuar com Apple
            </button>
          )}

          {hasSocial && (
            <div className="my-2 flex items-center gap-3">
              <span className="h-px flex-1 bg-outline/60" />
              <span className="text-xs text-muted">ou continue com seu e-mail</span>
              <span className="h-px flex-1 bg-outline/60" />
            </div>
          )}

          <form className="flex flex-col gap-3" onSubmit={sendCode}>
            <label className="sr-only" htmlFor="login-email">
              Seu e-mail
            </label>
            <div className="flex h-14 items-center gap-3 rounded-2xl border border-outline bg-canvas px-4 focus-within:border-primary focus-within:outline-[3px] focus-within:outline-primary focus-within:outline-offset-[3px]">
              <Mail aria-hidden="true" size={20} className="shrink-0 text-muted" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="seu.email@exemplo.com"
                required
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted focus-visible:outline-none"
              />
            </div>
            <button type="submit" disabled={busy} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-base font-extrabold text-white transition active:opacity-80 disabled:opacity-50">
              Continuar com E-mail
              {busy ? <Loader2 aria-hidden="true" size={20} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={20} />}
            </button>
          </form>

          {error && (
            <p role="alert" className="m-0 rounded-xl bg-red-50 p-3 text-sm leading-5 text-red-700">
              {error}
            </p>
          )}
        </div>

        <p className="m-0 mt-8 text-center text-xs leading-5 text-muted">
          Ao continuar, você concorda com os{" "}
          <a href="/terms" className="font-bold text-primary underline">
            Termos
          </a>{" "}
          e a{" "}
          <a href="/privacy" className="font-bold text-primary underline">
            Privacidade
          </a>
          .
        </p>
      </div>
    </div>
  );
}
