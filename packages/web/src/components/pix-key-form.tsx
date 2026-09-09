"use client";

import { pixKeyField, type PaymentMethod, type PaymentMethodsPage, type PixKeyType } from "@receivy/common";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";

type PixKeyFormProps = { returnTo?: string; required?: boolean };

const TYPES: { value: PixKeyType; label: string }[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "phone", label: "Celular" },
  { value: "email", label: "E-mail" },
  { value: "random", label: "Chave aleatória" },
];

const SAVE_ERROR = "Não foi possível salvar a chave Pix.";

// `keyboard` is the shared vocabulary with the native app; the web maps it to
// the matching `inputMode` so the mobile keyboard opens on the right layout.
const INPUT_MODES: Record<string, "numeric" | "tel" | "email" | "text"> = {
  numeric: "numeric",
  tel: "tel",
  email: "email",
  text: "text",
};

export function PixKeyForm({ returnTo, required = false }: PixKeyFormProps) {
  const router = useRouter();
  const [type, setType] = useState<PixKeyType>("email");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [label, setLabel] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [accountEmail, setAccountEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;

    void browserFetch("/api/financial/payment-methods")
      .then(response => (response.ok ? (response.json() as Promise<PaymentMethodsPage>) : null))
      .then(page => {
        if (!live || !page) {
          return;
        }

        // The very first key of an account is its main one; later keys only take
        // over when the person says so.
        setMakeDefault(!page.paymentMethods.some(method => !method.archivedAt));
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;

    void browserFetch("/api/auth/me")
      .then(response => (response.ok ? (response.json() as Promise<{ user: { email: string | null } }>) : null))
      .then(payload => {
        if (live && payload?.user?.email) {
          setAccountEmail(payload.user.email);
        }
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  const spec = pixKeyField(type);
  // Most people register their own e-mail, so an untouched e-mail field shows the
  // account e-mail. It stays editable: typing — or clearing it — takes over, and
  // picking another type starts over.
  const value = type === "email" && !key && !touched ? accountEmail : key;

  function pick(next: PixKeyType) {
    setType(next);
    setKey("");
    setTouched(false);
    setError("");
  }

  function change(raw: string) {
    setTouched(true);
    setKey(pixKeyField(type).format(raw));
  }

  async function paste() {
    setError("");

    try {
      const text = await navigator.clipboard?.readText();

      if (!text) {
        field.current?.focus();
        return;
      }

      change(text);
    } catch {
      field.current?.focus();
    }
  }

  function clear() {
    setTouched(true);
    setKey("");
    field.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const response = await browserFetch("/api/financial/payment-methods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pixKeyType: type, pixKey: spec.unformat(value), ...(label ? { label } : {}) }),
      });

      if (!response.ok) {
        throw new Error(await responseMessage(response, SAVE_ERROR));
      }

      const saved = (await response.json()) as PaymentMethod;

      if (makeDefault && !saved.isDefault) {
        await browserFetch(`/api/financial/payment-methods/${saved.id}/default`, { method: "POST" });
      }

      // Came from the billing form: hand the new key back to the draft.
      if (returnTo) {
        patchDraft({ pix: saved.id });
        router.push(returnTo);
        return;
      }

      router.push("/settings/pix");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="billing-form pix-key-form" onSubmit={submit}>
      <header className="billing-form-header">
        <h1>Nova chave Pix</h1>
        <p className="form-hint">A chave aparece no link de pagamento. O pagamento acontece no banco.</p>
      </header>

      {required && (
        <p className="pix-required-notice" role="status">
          Você precisa de uma chave Pix para criar cobranças.
        </p>
      )}

      <fieldset className="form-step">
        <legend>Tipo de chave</legend>
        <div className="pix-type-grid" role="radiogroup" aria-label="Tipo de chave">
          {TYPES.map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={type === option.value}
              className={type === option.value ? "pix-type is-active" : "pix-type"}
              onClick={() => pick(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="form-step">
        <legend>Chave</legend>

        <label htmlFor="pix-key">{spec.label}</label>
        <div className="pix-key-row">
          <input
            id="pix-key"
            ref={field}
            type="text"
            required
            maxLength={254}
            inputMode={INPUT_MODES[spec.keyboard]}
            placeholder={spec.placeholder}
            value={value}
            onChange={event => change(event.target.value)}
          />
          {value ? (
            <button type="button" className="secondary-button" onClick={clear}>
              Limpar
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={() => void paste()}>
              Colar
            </button>
          )}
        </div>

        <label htmlFor="pix-label">Banco (opcional)</label>
        <input id="pix-label" type="text" maxLength={120} placeholder="Nubank" value={label} onChange={event => setLabel(event.target.value)} />

        <label className="owner-toggle" htmlFor="pix-default">
          <input id="pix-default" type="checkbox" checked={makeDefault} onChange={event => setMakeDefault(event.target.checked)} />
          Definir como chave principal
        </label>
      </fieldset>

      <footer className="billing-form-footer">
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Salvando…" : "Salvar chave Pix"}
        </button>
      </footer>
    </form>
  );
}
