"use client";

import { pixKeyField, type PaymentMethod, type PaymentMethodsPage } from "@receivy/common";
import { Check, CircleCheck, Lock, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { PIX_TYPE_LABELS, PixTypeIcon } from "@/components/ui/pix-type-icon";
import { ScreenFooter } from "@/components/ui/screen-footer";

type PixSettingsScreenProps = { returnTo?: string; required?: boolean };

const LIST_ERROR = "Não foi possível carregar suas chaves Pix.";
const UPDATE_ERROR = "Não foi possível atualizar suas chaves Pix.";
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
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // The trash button that opened the dialog; the keyboard goes back to it on cancel.
  const trigger = useRef<HTMLButtonElement | null>(null);

  const newKeyHref = formHref({ returnTo, required });

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

  function closeDialog() {
    setRemoving(null);
    trigger.current?.focus();
  }

  async function act(method: PaymentMethod, action: "default" | "archive") {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await browserFetch(`/api/financial/payment-methods/${method.id}/${action}`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, UPDATE_ERROR));
      }

      setRemoving(null);
      setNotice(action === "default" ? "Chave principal atualizada." : "Chave excluída.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : UPDATE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-4">
      {required && (
        <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900" role="status">
          Você precisa de uma chave Pix para criar cobranças.
        </p>
      )}

      <h2 className="m-0 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">CHAVES ATIVAS ({items.length})</h2>

      {error && (
        <p role="alert" className="m-0 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="m-0 rounded-xl bg-primary-soft/50 p-4 text-sm font-semibold text-primary-strong">
          {notice}
        </p>
      )}

      {!items.length && !error && (
        <section className="flex flex-col items-center gap-2 rounded-2xl border border-outline/40 bg-surface p-8 text-center">
          <h3 className="m-0 text-lg font-extrabold text-primary-strong">Nenhuma chave ainda</h3>
          <p className="m-0 text-sm leading-5 text-muted">Cadastre uma chave para receber pelos links de cobrança.</p>
          <Link className="mt-2 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-white" href={newKeyHref}>
            Cadastrar nova chave
          </Link>
        </section>
      )}

      <div className="grid gap-3.5 md:grid-cols-2">
        {items.map(method => (
          <article key={method.id} className="flex flex-col gap-3 rounded-2xl border border-outline/30 bg-surface p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex flex-1 items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${method.isDefault ? "bg-primary text-white" : "bg-surface-muted text-primary-strong"}`}>
                  <PixTypeIcon type={method.pixKeyType} size={20} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <strong className="text-base font-bold text-ink">{PIX_TYPE_LABELS[method.pixKeyType]}</strong>
                  <div className="flex">
                    {method.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft/70 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">
                        <Check size={11} aria-hidden="true" />
                        Padrão
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">Secundária</span>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                aria-label="Excluir"
                title={`Remover a chave ${PIX_TYPE_LABELS[method.pixKeyType]}`}
                disabled={busy}
                onClick={event => {
                  trigger.current = event.currentTarget;
                  setRemoving(method);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-red-700 transition hover:bg-red-50 active:scale-95 disabled:opacity-50"
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-outline/30 bg-surface-muted/70 p-3">
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-wider text-ink">{pixKeyField(method.pixKeyType).format(method.pixKey)}</span>
              <CopyButton value={method.pixKey} ariaLabel="Copiar chave" variant="outline" onRefused={() => setError(COPY_ERROR)} />
            </div>

            {!method.isDefault && (
              <div className="flex border-t border-outline/20 pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(method, "default")}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-outline/40 px-3 text-xs font-semibold text-primary transition hover:bg-surface-muted disabled:opacity-50"
                >
                  <CircleCheck size={16} aria-hidden="true" />
                  Tornar padrão
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      <aside className="flex items-start gap-3 rounded-2xl border border-outline/30 bg-surface-muted/70 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft/60 text-[#006c49]">
          <Lock size={18} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-xs font-bold text-ink">Privacidade</h3>
          <p className="m-0 text-xs leading-5 text-muted">{SAFETY_NOTE}</p>
        </div>
      </aside>

      <ScreenFooter className="-mx-1 bg-canvas/95 px-1 pb-2 pt-3 backdrop-blur-md">
        <Link
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-white transition active:scale-[0.98]"
          href={newKeyHref}
          aria-label="Cadastrar nova chave"
        >
          <Plus size={20} aria-hidden="true" />
          Cadastrar Nova Chave
        </Link>
      </ScreenFooter>

      {removing && (
        <ConfirmDialog
          title="Excluir chave Pix?"
          subtitle="Esta ação não pode ser desfeita."
          icon={Trash2}
          detail={
            <>
              <span className="text-[11px] font-medium text-muted">{PIX_TYPE_LABELS[removing.pixKeyType]}</span>
              <span className="text-sm font-bold text-ink">{pixKeyField(removing.pixKeyType).format(removing.pixKey)}</span>
            </>
          }
          explanation="A chave sai dos próximos links de cobrança. As cobranças já criadas não mudam."
          confirmLabel="Remover"
          busy={busy}
          onConfirm={() => void act(removing, "archive")}
          onCancel={closeDialog}
        />
      )}
    </section>
  );
}
