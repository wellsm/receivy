"use client";

import { normalizeContact, pixKeyField, PixKeyType, type Contact, type ContactPaymentMethodInput, type PaymentMethod, type PaymentMethodsPage } from "@receivy/common";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { PixKeyFields } from "@/components/app/pix-key-fields";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PIX_TYPE_LABELS, PixTypeIcon } from "@/components/ui/pix-type-icon";
import { ScreenFooter } from "@/components/ui/screen-footer";

type ContactFormScreenProps = { contactId?: string; returnTo?: string };

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const EMAIL_NOTE = "Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.";
const PIX_NOTE = "A chave que você usa para pagar esta pessoa. Ela entra como a chave padrão do contato.";
const LOAD_ERROR = "Não foi possível carregar o contato.";
const SAVE_ERROR = "Não foi possível salvar o contato.";
const KEYS_ERROR = "Não foi possível carregar as chaves Pix do contato.";
const KEYS_UPDATE_ERROR = "Não foi possível atualizar as chaves Pix do contato.";

const FIELD_CLASS = "min-h-12 w-full rounded-xl border border-outline/60 bg-surface px-4 text-[15px] text-ink placeholder:text-muted";
const FROZEN_CLASS = "min-h-12 w-full rounded-xl border border-outline/30 bg-surface-muted px-4 text-[15px] text-muted";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** The contacts proxy already speaks pt-BR: it answers with a `message`, not an error code. */
async function contactError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };

    if (typeof body.message === "string" && body.message) {
      return body.message;
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export function ContactFormScreen({ contactId, returnTo }: ContactFormScreenProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [linked, setLinked] = useState(false);
  const [pixType, setPixType] = useState<PixKeyType>(PixKeyType.Email);
  // The key as the person sees it: masked for the current type, canonicalized only on submit.
  const [pixKey, setPixKey] = useState("");
  const [pixLabel, setPixLabel] = useState("");
  const [keys, setKeys] = useState<PaymentMethod[]>([]);
  const [archiving, setArchiving] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The Arquivar button that opened the dialog; the keyboard goes back to it on cancel.
  const trigger = useRef<HTMLButtonElement | null>(null);

  const loadKeys = useCallback(() => {
    if (!contactId) {
      return Promise.resolve();
    }

    return browserFetch(`/api/financial/payment-methods?contactId=${contactId}`)
      .then(async response => {
        if (!response.ok) {
          throw new Error(await responseMessage(response, KEYS_ERROR));
        }

        const page = (await response.json()) as PaymentMethodsPage;

        setKeys(page.paymentMethods.filter(method => !method.archivedAt));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : KEYS_ERROR));
  }, [contactId]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    if (!contactId) {
      return;
    }

    let live = true;

    void browserFetch(`/api/contacts/${contactId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await contactError(response, LOAD_ERROR));
        }

        return response.json() as Promise<Contact>;
      })
      .then((contact) => {
        if (!live) {
          return;
        }

        setName(contact.name);
        setNickname(contact.nickname ?? "");
        setEmail(contact.email);
        setLinked(contact.status === "active");
      })
      .catch((reason) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        }
      });

    return () => {
      live = false;
    };
  }, [contactId]);

  function pickPixType(type: PixKeyType) {
    setPixType(type);
    setPixKey("");
    setError("");
  }

  /** The typed key travels canonical (`+55…`, digits only); only the field keeps the mask. */
  function paymentMethodInput(): { paymentMethod?: ContactPaymentMethodInput } {
    const key = pixKeyField(pixType).unformat(pixKey);

    if (!key) {
      return {};
    }

    const label = pixLabel.trim();

    return { paymentMethod: { pixKeyType: pixType, pixKey: key, ...(label ? { label } : {}) } };
  }

  function closeDialog() {
    setArchiving(null);
    trigger.current?.focus();
  }

  async function act(id: string, action: "default" | "archive") {
    setBusy(true);
    setError("");

    try {
      const response = await browserFetch(`/api/financial/payment-methods/${id}/${action}`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, KEYS_UPDATE_ERROR));
      }

      setArchiving(null);
      await loadKeys();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : KEYS_UPDATE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    let input;

    try {
      input = normalizeContact({ name, nickname, email, ...paymentMethodInput() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confira os dados do contato.");
      return;
    }

    setBusy(true);

    try {
      const response = await browserFetch(contactId ? `/api/contacts/${contactId}` : "/api/contacts", {
        method: contactId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(await contactError(response, SAVE_ERROR));
      }

      const saved = (await response.json()) as Contact;

      if (contactId) {
        router.push(returnTo ?? `/contacts/${contactId}`);
        return;
      }

      // Came from the billing form: hand the new contact back to the draft, which seats participants by
      // account and the one who receives by agenda entry.
      if (returnTo) {
        patchDraft({ contact: { id: saved.id, userId: saved.userId } });
        router.push(returnTo);
        return;
      }

      router.push("/contacts");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mx-auto flex w-full max-w-md flex-col gap-4 pb-4 md:max-w-2xl" onSubmit={submit}>
      <p className="m-0 leading-6 text-muted">{INTRO}</p>

      {linked && (
        <p className="m-0 rounded-xl bg-warning-soft p-4 text-sm font-semibold text-warning" role="status">
          {LINKED_NOTE}
        </p>
      )}

      <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
        <legend className="sr-only">Dados do contato</legend>

        <div className="grid gap-4 md:grid-cols-2">
          <Field id="contact-name" label="Nome completo">
            <input
              id="contact-name"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              placeholder="Maria Silva"
              disabled={linked}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={linked ? FROZEN_CLASS : FIELD_CLASS}
            />
          </Field>

          <Field id="contact-nickname" label="Apelido">
            <input id="contact-nickname" type="text" maxLength={60} placeholder="Como prefere chamar" value={nickname} onChange={(event) => setNickname(event.target.value)} className={FIELD_CLASS} />
          </Field>

          <Field id="contact-email" label="E-mail (opcional)" hint={EMAIL_NOTE}>
            <input
              id="contact-email"
              type="email"
              inputMode="email"
              maxLength={254}
              autoComplete="email"
              placeholder="contato@email.com"
              disabled={linked}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={linked ? FROZEN_CLASS : FIELD_CLASS}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
        <legend className="px-1 text-sm font-bold text-ink">Chave Pix (opcional)</legend>
        <p className="m-0 text-xs leading-5 text-muted">{PIX_NOTE}</p>

        {keys.length > 0 && (
          <ul aria-label="Chaves Pix do contato" className="m-0 flex list-none flex-col gap-2 p-0">
            {keys.map(key => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-outline/30 bg-surface-muted/60 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                  <PixTypeIcon type={key.pixKeyType} size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{key.label || PIX_TYPE_LABELS[key.pixKeyType]}</span>
                    {key.isDefault && <span className="rounded-full bg-primary-soft/70 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">Padrão</span>}
                  </span>
                  <span className="truncate text-[11px] text-muted">{pixKeyField(key.pixKeyType).format(key.pixKey)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {!key.isDefault && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(key.id, "default")}
                      className="min-h-10 rounded-lg border border-outline/40 px-3 text-xs font-semibold text-primary disabled:opacity-50"
                    >
                      Definir padrão
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={event => {
                      trigger.current = event.currentTarget;
                      setArchiving(key);
                    }}
                    className="min-h-10 rounded-lg px-3 text-xs font-semibold text-danger disabled:opacity-50"
                  >
                    Arquivar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <PixKeyFields type={pixType} value={pixKey} inputId="contact-pix-key" onPickType={pickPixType} onChange={raw => setPixKey(pixKeyField(pixType).format(raw))} />

        <Field id="contact-pix-label" label="Rótulo da chave">
          <input id="contact-pix-label" type="text" maxLength={60} placeholder="Rótulo (opcional)" value={pixLabel} onChange={event => setPixLabel(event.target.value)} className={FIELD_CLASS} />
        </Field>
      </fieldset>

      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
      )}

      <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pb-2 pt-4 backdrop-blur-md">
        <button
          type="submit"
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-on-primary transition active:scale-[0.985] disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} aria-hidden="true" className="animate-spin" /> : <Check size={18} aria-hidden="true" />}
          {busy ? "Salvando…" : "Salvar contato"}
        </button>
      </ScreenFooter>

      {archiving && (
        <ConfirmDialog
          title="Arquivar chave Pix?"
          subtitle="Esta ação não pode ser desfeita."
          icon={Trash2}
          detail={
            <>
              <span className="text-[11px] font-medium text-muted">{PIX_TYPE_LABELS[archiving.pixKeyType]}</span>
              <span className="text-sm font-bold text-ink">{pixKeyField(archiving.pixKeyType).format(archiving.pixKey)}</span>
            </>
          }
          explanation="A chave sai das próximas contas a pagar deste contato. As contas já criadas não mudam."
          confirmLabel="Arquivar"
          busy={busy}
          onConfirm={() => void act(archiving.id, "archive")}
          onCancel={closeDialog}
        />
      )}
    </form>
  );
}
