"use client";

import { formatRemaining, LOGIN_CODE_TTL_MS, maskEmail, RESEND_COOLDOWN_MS } from "@receivy/common";
import { ArrowLeft, ArrowRight, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { CODE_LENGTH, CodeBoxes } from "@/components/ui/code-boxes";
import { readPendingLogin, writePendingLogin, type PendingLogin } from "@/lib/auth/pending-login";
import { responseMessage } from "@/lib/financial-response";

export function CodeScreen() {
  const router = useRouter();
  // Read once when the component mounts; readPendingLogin() only touches
  // sessionStorage (unavailable during any server render) and safely
  // returns null there, so this stays SSR-safe without needing an effect.
  const [pending, setPending] = useState<PendingLogin | null>(() => readPendingLogin());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const remaining = pending.sentAt + LOGIN_CODE_TTL_MS - now;
  const expired = remaining <= 0;
  const cooldown = pending.sentAt + RESEND_COOLDOWN_MS - now;
  const canResend = !busy && !resending && cooldown <= 0;
  const canConfirm = !busy && !expired && code.length === CODE_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!pending || !canConfirm) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pending.email, code }),
      });

      if (!response.ok) {
        setError(await responseMessage(response, "Código inválido ou expirado. Peça um novo código e tente novamente."));
        setBusy(false);

        return;
      }

      // Left busy on purpose: the full page navigation replaces this screen, and clearing it
      // here would flash the button back to idle mid-navigation.
      window.location.assign(pending.nextPath);
    } catch {
      setError("Não foi possível entrar agora.");
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending || !canResend) {
      return;
    }

    setResending(true);
    setError(null);
    setNotice(null);

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
      setCode("");
      setNotice("Enviamos um novo código.");
    } catch {
      setError("Não foi possível enviar o código agora.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col md:max-w-lg">
      <header className="grid h-14 grid-cols-[44px_1fr_44px] items-center">
        <Link href="/login" aria-label="Voltar" className="flex h-11 w-11 items-center justify-center rounded-full text-primary-strong hover:bg-surface-muted">
          <ArrowLeft aria-hidden="true" size={22} />
        </Link>
        <span className="text-center text-base font-bold text-primary-strong">Código</span>
      </header>

      <div className="mt-4 md:rounded-3xl md:border md:border-outline/60 md:bg-surface md:p-8">
        <div className="flex flex-col items-center">
          <div aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-soft/40 text-primary-strong">
            <ShieldCheck size={36} />
          </div>
          <h1 className="m-0 mt-6 text-center text-3xl font-extrabold tracking-tight text-primary-strong">Digite o código de 6 dígitos</h1>
          <p className="m-0 mt-3 px-6 text-center text-base leading-6 text-muted">Enviamos um código de segurança temporário para</p>
          <p className="m-0 text-center text-base font-bold text-ink">{maskEmail(pending.email)}</p>
        </div>

        <form onSubmit={submit}>
          <p className="m-0 mb-3 mt-8 text-center text-sm font-semibold text-ink">Código de Verificação</p>
          <CodeBoxes value={code} onChange={setCode} disabled={busy || expired} />

          <div className="mt-3 flex items-center gap-2">
            <Lock aria-hidden="true" size={16} className="shrink-0 text-muted" />
            {expired ? (
              <p className="m-0 text-sm font-semibold text-danger">Código expirado. Peça um novo código.</p>
            ) : (
              <p className="m-0 text-sm text-muted">
                Expira em <strong className="font-extrabold text-ink">{formatRemaining(remaining)}</strong>
              </p>
            )}
          </div>

          <button type="submit" disabled={!canConfirm} className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-extrabold text-on-primary transition active:opacity-80 disabled:opacity-50">
            Confirmar e Entrar
            {busy ? <Loader2 aria-hidden="true" size={20} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={20} />}
          </button>
        </form>

        {error && (
          <p role="alert" className="m-0 mt-4 rounded-xl bg-danger-soft p-3 text-sm leading-5 text-danger">
            {error}
          </p>
        )}
        {notice && !error && (
          <p aria-live="polite" className="m-0 mt-4 text-center text-sm text-primary">
            {notice}
          </p>
        )}

        <div className="mt-8 border-t border-outline/50 pt-6">
          <p className="m-0 text-center text-base font-semibold text-ink">Não recebeu o código?</p>
          <button type="button" disabled={!canResend} onClick={() => void resend()} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 text-base font-bold text-primary transition disabled:opacity-50">
            <RefreshCw aria-hidden="true" size={18} />
            {cooldown > 0 ? `Reenviar em ${formatRemaining(cooldown)}` : "Reenviar código"}
          </button>
        </div>
      </div>
    </div>
  );
}
