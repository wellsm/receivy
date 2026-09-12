"use client";

import { formatRemaining, LOGIN_CODE_TTL_MS, maskEmail, RESEND_COOLDOWN_MS } from "@receivy/common";
import { ArrowLeft, ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { readPendingLogin, writePendingLogin, type PendingLogin } from "@/lib/auth/pending-login";
import { responseMessage } from "@/lib/financial-response";

const CODE_LENGTH = 6;

export function CodeLoginForm() {
  const router = useRouter();
  // Read once when the component mounts; readPendingLogin() only touches
  // sessionStorage (unavailable during any server render) and safely
  // returns null there, so this stays SSR-safe without needing an effect.
  const [pending, setPending] = useState<PendingLogin | null>(() => readPendingLogin());
  const [digits, setDigits] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pending) {
      router.replace("/login");
    }
  }, [pending, router]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!pending) {
    return null;
  }

  const remainingMs = pending.sentAt + LOGIN_CODE_TTL_MS - now;
  const expired = remainingMs <= 0;
  const cooldownMs = pending.sentAt + RESEND_COOLDOWN_MS - now;
  const cooling = cooldownMs > 0;

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (!pending) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pending.email, code: digits }),
      });

      if (!response.ok) {
        setError(await responseMessage(
          response,
          "Código inválido ou expirado. Peça um novo código e tente novamente.",
        ));
        return;
      }

      window.location.assign(pending.nextPath);
    } catch {
      setError("Não foi possível entrar agora.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (!pending) {
      return;
    }

    setResending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pending.email }),
      });

      if (!response.ok) {
        setError(await responseMessage(response, "Não foi possível enviar o código agora."));
        return;
      }

      const refreshed = { ...pending, sentAt: Date.now() };
      writePendingLogin(refreshed);
      setPending(refreshed);
      setDigits("");
    } catch {
      setError("Não foi possível enviar o código agora.");
    } finally {
      setResending(false);
    }
  }

  const activeIndex = focused ? Math.min(digits.length, CODE_LENGTH - 1) : -1;

  return (
    <div className="login-code-page">
      <div className="login-topbar">
        <Link className="login-back-link" href="/login">
          <ArrowLeft aria-hidden="true" size={18} />
          Voltar
        </Link>
        <span className="login-secure-pill">
          <ShieldCheck aria-hidden="true" size={14} />
          Conexão Segura
        </span>
      </div>

      <div className="login-card login-code-card">
        <div className="login-shield-square" aria-hidden="true">
          <ShieldCheck size={28} />
        </div>
        <h2 className="login-code-title">Digite o código de 6 dígitos</h2>
        <p className="login-code-copy">
          Enviamos um código de segurança temporário para <strong>{maskEmail(pending.email)}</strong>
        </p>

        <form onSubmit={confirmCode}>
          <p className="login-code-field-label">Código de Verificação</p>
          <div className="code-boxes">
            <div className="code-boxes__row" aria-hidden="true">
              {Array.from({ length: CODE_LENGTH }).map((_, index) => (
                <span
                  key={index}
                  className={index === activeIndex ? "code-boxes__digit code-boxes__digit--active" : "code-boxes__digit"}
                >
                  {digits[index] ?? ""}
                </span>
              ))}
            </div>
            <input
              id="login-code"
              className="code-boxes__input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              autoFocus
              aria-label="Código de 6 dígitos"
              value={digits}
              onChange={(event) => setDigits(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </div>

          <p className={expired ? "login-countdown login-countdown--expired" : "login-countdown"}>
            {expired ? "Código expirado. Peça um novo código." : `Expira em ${formatRemaining(remainingMs)}`}
          </p>

          <button
            className="login-submit"
            type="submit"
            disabled={busy || expired || digits.length !== CODE_LENGTH}
          >
            {busy ? "Confirmando…" : "Confirmar e Entrar"}
            {!busy && <ArrowRight aria-hidden="true" size={19} />}
          </button>
        </form>

        {error && <p className="login-error" role="alert">{error}</p>}

        <div className="login-help">
          <span>Não recebeu o código?</span>
          <button
            type="button"
            className="login-text-button"
            onClick={() => void resendCode()}
            disabled={resending || cooling}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {cooling ? `Reenviar em ${formatRemaining(cooldownMs)}` : "Reenviar código"}
          </button>
        </div>
      </div>
    </div>
  );
}
