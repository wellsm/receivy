"use client";

import { formatPhoneBR, normalizePerson, type Person } from "@receivy/common";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { patchDraft } from "@/lib/billing-draft";

type ContactFormProps = { personId?: string; returnTo?: string };

const INTRO = "Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";
const LOAD_ERROR = "Não foi possível carregar o contato.";
const SAVE_ERROR = "Não foi possível salvar o contato.";

/** The people proxy already speaks pt-BR: it answers with a `message`, not an error code. */
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

export function ContactForm({ personId, returnTo }: ContactFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!personId) {
      return;
    }

    let live = true;

    void browserFetch(`/api/people/${personId}`)
      .then(async response => {
        if (!response.ok) {
          throw new Error(await contactError(response, LOAD_ERROR));
        }

        return response.json() as Promise<Person>;
      })
      .then(person => {
        if (!live) {
          return;
        }

        setName(person.name);
        setNickname(person.nickname ?? "");
        setPhone(formatPhoneBR(person.phone ?? ""));
        setEmail(person.email ?? "");
        setLinked(person.hasAccount);
      })
      .catch(reason => {
        if (live) {
          setError(reason instanceof Error ? reason.message : LOAD_ERROR);
        }
      });

    return () => {
      live = false;
    };
  }, [personId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    let input;

    try {
      // `normalizePerson` accepts the masked phone and hands back `+55…`, so the
      // field can stay readable while the API keeps its canonical shape.
      input = normalizePerson({ name, nickname, email, phone });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confira os dados do contato.");
      return;
    }

    setBusy(true);

    try {
      const response = await browserFetch(personId ? `/api/people/${personId}` : "/api/people", {
        method: personId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(await contactError(response, SAVE_ERROR));
      }

      const saved = (await response.json()) as Person;

      if (personId) {
        router.push(returnTo ?? `/people/${personId}`);
        return;
      }

      // Came from the billing form: hand the new contact back to the draft.
      if (returnTo) {
        patchDraft({ selected: [saved.id] });
        router.push(returnTo);
        return;
      }

      router.push("/people");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="billing-form contact-form" onSubmit={submit}>
      <header className="billing-form-header">
        <h1>{personId ? "Editar contato" : "Novo contato"}</h1>
        <p className="form-hint">{INTRO}</p>
      </header>

      {linked && <p className="billing-frozen-note">{LINKED_NOTE}</p>}

      <fieldset className="form-step">
        <legend>Dados do contato</legend>

        <label htmlFor="contact-name">Nome completo</label>
        <input
          id="contact-name"
          type="text"
          required
          maxLength={120}
          autoComplete="name"
          placeholder="Maria Silva"
          disabled={linked}
          value={name}
          onChange={event => setName(event.target.value)}
        />

        <label htmlFor="contact-nickname">Apelido</label>
        <input
          id="contact-nickname"
          type="text"
          maxLength={60}
          placeholder="Como prefere chamar"
          value={nickname}
          onChange={event => setNickname(event.target.value)}
        />

        <label htmlFor="contact-phone">WhatsApp / Celular</label>
        <input
          id="contact-phone"
          type="text"
          inputMode="tel"
          maxLength={20}
          autoComplete="tel"
          placeholder="(11) 98765-4321"
          disabled={linked}
          value={phone}
          onChange={event => setPhone(formatPhoneBR(event.target.value))}
        />
        <p className="form-hint">Usado para lembretes.</p>

        <label htmlFor="contact-email">E-mail</label>
        <input
          id="contact-email"
          type="email"
          inputMode="email"
          maxLength={254}
          autoComplete="email"
          placeholder="contato@email.com"
          disabled={linked}
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
        <p className="form-hint">Usado para enviar avisos.</p>
      </fieldset>

      <footer className="billing-form-footer">
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Salvando…" : "Salvar contato"}
        </button>
      </footer>
    </form>
  );
}
