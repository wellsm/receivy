"use client";

import { Apple, ArrowRight, KeyRound, Mail } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

type LoginFormProps = { nextPath: string };

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
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
      setStep("code");
    } catch {
      setError("Não foi possível enviar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/email/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!response.ok) {
        setError(await responseMessage(
          response,
          "Código inválido ou expirado. Peça um novo código e tente novamente.",
        ));
        return;
      }
      window.location.assign(nextPath);
    } catch {
      setError("Não foi possível entrar agora.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-form-wrap">
      <div className="social-login-grid" aria-describedby="social-login-note">
        <button type="button" className="social-login-button" disabled>
          <span className="google-g" aria-hidden="true">G</span>
          Continuar com Google
        </button>
        <button type="button" className="social-login-button" disabled>
          <Apple aria-hidden="true" size={19} />
          Continuar com Apple
        </button>
      </div>
      <p id="social-login-note" className="social-login-note">
        Google e Apple serão liberados após a configuração dos provedores.
      </p>

      <div className="login-divider"><span>ou use seu e-mail</span></div>

      {step === "email" ? (
        <form className="login-form" onSubmit={sendCode}>
          <label htmlFor="login-email">Seu e-mail</label>
          <div className="login-input-shell">
            <Mail aria-hidden="true" size={20} />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
              required
            />
          </div>
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? "Enviando…" : "Receber código"}
            {!busy && <ArrowRight aria-hidden="true" size={19} />}
          </button>
        </form>
      ) : (
        <form className="login-form" onSubmit={confirmCode}>
          <div className="login-code-heading">
            <span className="login-code-icon"><KeyRound aria-hidden="true" size={20} /></span>
            <div>
              <strong>Confira seu e-mail</strong>
              <p>Enviamos um código para {email}.</p>
            </div>
          </div>
          <label htmlFor="login-code">Código de 6 dígitos</label>
          <input
            className="login-code-input"
            id="login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            required
          />
          <button className="login-submit" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Confirmando…" : "Entrar"}
            {!busy && <ArrowRight aria-hidden="true" size={19} />}
          </button>
          <button className="login-text-button" type="button" onClick={() => void sendCode()} disabled={busy}>
            Enviar outro código
          </button>
        </form>
      )}

      {error && <p className="login-error" role="alert">{error}</p>}
      <p className="login-email-reminder">
        Use o mesmo e-mail em que recebeu uma cobrança para encontrá-la na sua timeline.
      </p>
    </div>
  );
}
