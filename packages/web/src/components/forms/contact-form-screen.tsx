import { normalizeContact, onlyDigits, paymentMethodText, PhoneSource, pixKeyField, PaymentProvider, PixKeyType, type Contact, type ContactPaymentMethodInput, type PaymentMethod, type PaymentMethodsPage } from "@receivy/common";
import { Check, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PixKeyFields } from "@/components/app/pix-key-fields";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { ScreenFooter } from "@/components/ui/screen-footer";
import { apiFetch, apiJson } from "@/lib/api/client";
import { patchDraft } from "@/lib/billing-draft";
import { contactErrorMessage } from "@/lib/contacts-errors";
import { responseMessage } from "@/lib/financial-response";
import { useAppNavigate } from "@/lib/navigate";
import { whatsappEnabled } from "@/lib/whatsapp-flag";

type ContactFormScreenProps = { contactId?: string; returnTo?: string };

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const EMAIL_NOTE = "Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.";
const PHONE_LOCKED_NOTE = "Número informado pela própria pessoa";
const PIX_NOTE = "A chave que você usa para pagar esta pessoa. Ela entra como a chave padrão do contato.";
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

export function ContactFormScreen({ contactId, returnTo }: ContactFormScreenProps) {
  const navigate = useAppNavigate();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneSource, setPhoneSource] = useState<PhoneSource | null>(null);
  const [whatsappConsent, setWhatsappConsent] = useState(false);
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

    return apiFetch(`payment-methods?contactId=${encodeURIComponent(contactId)}`)
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

    void apiJson<Contact>(`contacts/${encodeURIComponent(contactId)}`)
      .then((contact) => {
        if (!live) {
          return;
        }

        setName(contact.name);
        setNickname(contact.nickname ?? "");
        setEmail(contact.email);
        setPhone(contact.phone ?? "");
        setPhoneSource(contact.phoneSource);
        setWhatsappConsent(Boolean(contact.whatsappConsentAt));
        setLinked(contact.status === "active");
      })
      .catch((reason) => {
        if (live) {
          setError(contactErrorMessage(reason));
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

    return { paymentMethod: { provider: PaymentProvider.Pix, kind: pixType, value: key, ...(label ? { label } : {}) } };
  }

  function closeDialog() {
    setArchiving(null);
    trigger.current?.focus();
  }

  /**
   * A refused "Definir padrão"/"Arquivar" has to be readable: the dialog covers the form's
   * alert, so a failure closes it and leaves the reason on the form. Only a change worth
   * showing reloads the list.
   */
  async function act(id: string, action: "default" | "archive") {
    setBusy(true);
    setError("");

    try {
      const response = await apiFetch(`payment-methods/${id}/${action}`, { method: "POST" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, KEYS_UPDATE_ERROR));
      }
    } catch (reason) {
      setArchiving(null);
      setError(reason instanceof Error ? reason.message : KEYS_UPDATE_ERROR);
      setBusy(false);

      return;
    }

    setArchiving(null);

    await loadKeys();

    setBusy(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    let input;
    const phoneEditable = phoneSource !== PhoneSource.Person;

    try {
      input = normalizeContact({ name, nickname, email, ...(phoneEditable ? { phone } : {}), ...(whatsappEnabled() ? { whatsappConsent } : {}), ...paymentMethodInput() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confira os dados do contato.");

      return;
    }

    setBusy(true);

    try {
      const saved = await apiJson<Contact>(contactId ? `contacts/${encodeURIComponent(contactId)}` : "contacts", {
        method: contactId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });

      if (contactId) {
        navigate(returnTo ?? `/contacts/${contactId}`);

        return;
      }

      // Came from the billing form: hand the new contact back to the draft, which seats participants by
      // account and the one who receives by agenda entry.
      if (returnTo) {
        patchDraft({ contact: { id: saved.id, userId: saved.userId } });
        navigate(returnTo);

        return;
      }

      navigate("/contacts");
    } catch (reason) {
      setError(contactErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const phoneLabel = whatsappEnabled() ? "WhatsApp" : "Telefone";

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

          <Field id="contact-phone" label={phoneLabel} hint={phoneSource === PhoneSource.Person ? PHONE_LOCKED_NOTE : undefined}>
            <input
              id="contact-phone"
              type="tel"
              aria-label={phoneLabel}
              inputMode="numeric"
              maxLength={11}
              placeholder="11988887777"
              disabled={phoneSource === PhoneSource.Person}
              value={phone}
              onChange={(event) => setPhone(onlyDigits(event.target.value))}
              className={phoneSource === PhoneSource.Person ? FROZEN_CLASS : FIELD_CLASS}
            />
          </Field>
        </div>

        {whatsappEnabled() ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={whatsappConsent} onChange={(event) => setWhatsappConsent(event.target.checked)} />
            Essa pessoa concordou em receber cobranças por WhatsApp
          </label>
        ) : null}
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-3xl border border-outline/40 bg-surface p-5">
        <legend className="px-1 text-sm font-bold text-ink">Chave Pix (opcional)</legend>
        <p className="m-0 text-xs leading-5 text-muted">{PIX_NOTE}</p>

        {keys.length > 0 && (
          <ul aria-label="Chaves Pix do contato" className="m-0 flex list-none flex-col gap-2 p-0">
            {keys.map(key => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-outline/30 bg-surface-muted/60 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                  <ProviderIcon method={key} size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{key.label || paymentMethodText(key).title}</span>
                    {key.isDefault && <span className="rounded-full bg-primary-soft/70 px-2 py-0.5 text-[11px] font-semibold text-primary-strong">Padrão</span>}
                  </span>
                  <span className="truncate text-[11px] text-muted">{paymentMethodText(key).value}</span>
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

      <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
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
              <span className="text-[11px] font-medium text-muted">{paymentMethodText(archiving).title}</span>
              <span className="text-sm font-bold text-ink">{paymentMethodText(archiving).value}</span>
            </>
          }
          explanation="A chave sai das próximas contas a pagar deste contato. As contas já criadas não mudam."
          confirmLabel={busy ? "Arquivando…" : "Arquivar"}
          busy={busy}
          onConfirm={() => void act(archiving.id, "archive")}
          onCancel={closeDialog}
        />
      )}
    </form>
  );
}
