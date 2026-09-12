"use client";

import { normalizeContact, type Contact } from "@receivy/common";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";
import { ScreenFooter } from "@/components/ui/screen-footer";

type ContactFormScreenProps = { contactId?: string; returnTo?: string };

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const EMAIL_NOTE = "Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.";
const LOAD_ERROR = "Não foi possível carregar o contato.";
const SAVE_ERROR = "Não foi possível salvar o contato.";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    let input;

    try {
      input = normalizeContact({ name, nickname, email });
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

      // Came from the billing form: hand the new contact back to the draft, which seats people by account.
      if (returnTo) {
        patchDraft({ selected: [saved.userId] });
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
        <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900" role="status">
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

      {error && (
        <p role="alert" className="m-0 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <ScreenFooter className="-mx-1 border-t border-outline/30 bg-canvas/95 px-1 pb-2 pt-4 backdrop-blur-md">
        <button
          type="submit"
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white transition active:scale-[0.985] disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} aria-hidden="true" className="animate-spin" /> : <Check size={18} aria-hidden="true" />}
          {busy ? "Salvando…" : "Salvar contato"}
        </button>
      </ScreenFooter>
    </form>
  );
}
