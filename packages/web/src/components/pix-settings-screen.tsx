"use client";

import { pixKeyField, type PaymentMethod, type PaymentMethodsPage, type PixKeyType } from "@receivy/common";
import { Building2, Copy, IdCard, KeyRound, Mail, MoreVertical, Plus, Smartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

type PixSettingsScreenProps = { returnTo?: string; required?: boolean };

const LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  phone: "Celular",
  email: "E-mail",
  random: "Chave aleatória",
};

const ICONS: Record<PixKeyType, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  cpf: IdCard,
  cnpj: Building2,
  phone: Smartphone,
  email: Mail,
  random: KeyRound,
};

const LIST_ERROR = "Não foi possível carregar suas chaves Pix.";
const COPY_ERROR = "Não foi possível copiar a chave.";
const SAFETY_NOTE = "Seus dados Pix ficam protegidos e nunca são compartilhados sem sua autorização.";

function formHref({ returnTo, required }: PixSettingsScreenProps): string {
  const query = new URLSearchParams({ ...(returnTo ? { returnTo } : {}), ...(required ? { required: "1" } : {}) });
  const suffix = query.toString();

  if (!suffix) {
    return "/settings/pix/new";
  }

  return `/settings/pix/new?${suffix}`;
}

export function PixSettingsScreen({ returnTo, required = false }: PixSettingsScreenProps) {
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);

  const newKeyHref = formHref({ returnTo, required });

  /** Escape dismisses the popover and hands the keyboard back to the `⋮` button. */
  function closeMenu() {
    trigger.current?.focus();
    setMenu(null);
  }

  const load = useCallback(() => {
    return browserFetch("/api/financial/payment-methods")
      .then(async response => {
        if (!response.ok) {
          throw new Error(await responseMessage(response, LIST_ERROR));
        }

        const page = (await response.json()) as PaymentMethodsPage;

        setItems(page.paymentMethods.filter(method => !method.archivedAt));
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : LIST_ERROR));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(method: PaymentMethod) {
    setError("");
    setNotice("");

    // A plain-http origin has no `navigator.clipboard` at all, and awaiting the
    // optional chain would resolve happily: the guard has to come first, or the
    // screen announces a copy that never happened.
    if (!navigator.clipboard?.writeText) {
      setError(COPY_ERROR);
      return;
    }

    try {
      await navigator.clipboard.writeText(method.pixKey);
      setNotice("Chave copiada");
    } catch {
      setError(COPY_ERROR);
    }
  }

  async function act(method: PaymentMethod, action: "default" | "archive") {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await browserFetch(`/api/financial/payment-methods/${method.id}/${action}`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível atualizar suas chaves Pix."));
      }

      setMenu(null);
      setConfirming(null);
      setNotice(action === "default" ? "Chave principal atualizada." : "Chave excluída.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar suas chaves Pix.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="financial-page pix-page">
      <header className="billings-header">
        <div>
          <h1>Minhas Chaves Pix</h1>
          <p>Chaves usadas nos links de cobrança</p>
        </div>
        <Link className="primary-button billings-new" href={newKeyHref}>
          <Plus size={16} aria-hidden="true" />
          Cadastrar nova chave
        </Link>
      </header>

      {required && (
        <p className="pix-required-notice" role="status">
          Você precisa de uma chave Pix para criar cobranças.
        </p>
      )}

      <h2 className="profile-section-title">CHAVES ATIVAS ({items.length})</h2>

      {error && (
        <p role="alert" className="login-error">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="billings-notice">
          {notice}
        </p>
      )}

      {!items.length && !error && (
        <section className="billings-empty">
          <h3>Nenhuma chave ainda</h3>
          <p>Cadastre uma chave para receber pelos links de cobrança.</p>
          <Link className="primary-button" href={newKeyHref}>
            Cadastrar nova chave
          </Link>
        </section>
      )}

      <div className="pix-key-list">
        {items.map(method => {
          const Icon = ICONS[method.pixKeyType];
          const name = method.label || LABELS[method.pixKeyType];

          return (
            <article
              key={method.id}
              className={method.isDefault ? "pix-key-card is-default" : "pix-key-card"}
              onKeyDown={event => {
                if (event.key !== "Escape" || menu !== method.id) {
                  return;
                }

                event.stopPropagation();
                closeMenu();
              }}
            >
              <div className="pix-key-card-top">
                <span className="billing-card-icon" aria-hidden="true">
                  <Icon size={18} aria-hidden={true} />
                </span>
                <div className="pix-key-card-title">
                  <strong>{LABELS[method.pixKeyType]}</strong>
                  {method.label && <small>{method.label}</small>}
                </div>
                {method.isDefault && <span className="feed-badge success">Principal</span>}
                <button
                  type="button"
                  className="billings-icon-button"
                  aria-label={`Mais ações da chave ${name}`}
                  aria-haspopup="true"
                  aria-expanded={menu === method.id}
                  ref={menu === method.id ? trigger : undefined}
                  onClick={() => setMenu(current => (current === method.id ? null : method.id))}
                >
                  <MoreVertical size={16} aria-hidden="true" />
                </button>
              </div>

              <p className="pix-key-value">{pixKeyField(method.pixKeyType).format(method.pixKey)}</p>

              <div className="pix-key-actions">
                <button type="button" className="secondary-button" onClick={() => void copy(method)}>
                  <Copy size={14} aria-hidden="true" />
                  Copiar chave
                </button>
                {!method.isDefault && (
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(method, "default")}>
                    Tornar padrão
                  </button>
                )}
              </div>

              {menu === method.id && (
                <div className="pix-key-menu">
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      setMenu(null);
                      setConfirming(method);
                    }}
                  >
                    Excluir
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="form-hint pix-safety-note">{SAFETY_NOTE}</p>

      <Link className="fab" href={newKeyHref} aria-label="Cadastrar nova chave">
        <Plus size={22} aria-hidden="true" />
      </Link>

      {confirming && (
        <div className="profile-backdrop">
          <section className="profile-dialog" role="alertdialog" aria-label="Excluir chave Pix" aria-modal="true">
            <h2>Excluir chave Pix</h2>
            <p>A chave sai dos próximos links de cobrança. As cobranças já criadas não mudam.</p>
            <div className="profile-dialog-actions">
              <button type="button" className="danger-button" disabled={busy} onClick={() => void act(confirming, "archive")}>
                Confirmar exclusão
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirming(null)}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
