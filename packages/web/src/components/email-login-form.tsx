"use client";

import { Apple, ArrowRight, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { GoogleMark } from "@/components/brand-marks";
import { isProviderAuthorizationUrl } from "@/lib/auth/oauth";
import { writePendingLogin } from "@/lib/auth/pending-login";
import { responseMessage } from "@/lib/financial-response";

type EmailLoginFormProps = {
  nextPath: string;
  oauthError?: boolean;
};

export function EmailLoginForm({ nextPath, oauthError = false }: EmailLoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError
    ? "Não foi possível concluir o login. Tente novamente ou use seu e-mail." : null);
  const [providers, setProviders] = useState({ google: false, apple: false });

  useEffect(() => {
    void fetch("/api/auth/oauth/providers").then(async (response) => {
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      setProviders({ google: data.google === true, apple: data.apple === true });
    }).catch(() => {});
  }, []);

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
      setError("Não foi possível iniciar o login. Tente novamente.");
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
        return;
      }

      writePendingLogin({ email, sentAt: Date.now(), nextPath });
      router.push("/login/code");
    } catch {
      setError("Não foi possível enviar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-hero">
      <div className="login-icon-halo">
        <div className="login-icon" aria-hidden="true">
          <span>R</span>
        </div>
      </div>
      <h1 className="login-title">Receivy</h1>
      <p className="login-subtitle">Controle o que tem a receber e a pagar</p>

      <div className="login-card">
        <div className="social-login-grid">
          <button
            type="button"
            className="social-login-button"
            disabled={busy || !providers.google}
            onClick={() => void socialLogin("google")}
          >
            <GoogleMark />
            Continuar com Google
          </button>
          <button
            type="button"
            className="social-login-button social-login-button--apple"
            disabled={busy || !providers.apple}
            onClick={() => void socialLogin("apple")}
          >
            <Apple aria-hidden="true" size={19} />
            Continuar com Apple
          </button>
        </div>

        <div className="login-divider"><span>ou continue com seu e-mail</span></div>

        <form className="login-form" onSubmit={sendCode}>
          <label className="sr-only" htmlFor="login-email">Seu e-mail</label>
          <div className="login-input-shell">
            <Mail aria-hidden="true" size={20} />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="seu.email@exemplo.com"
              required
            />
          </div>
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? "Enviando…" : "Continuar com E-mail"}
            {!busy && <ArrowRight aria-hidden="true" size={19} />}
          </button>
        </form>

        {error && <p className="login-error" role="alert">{error}</p>}
      </div>

      <p className="login-legal">
        Ao continuar, você concorda com os <a href="/terms">Termos</a> e a <a href="/privacy">Privacidade</a>.
      </p>
    </div>
  );
}
