"use client";

import { contactBadge, formatPhoneBR, initialsOf, type Contact, type ContactsPage } from "@receivy/common";
import { ChevronRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { StatusTag } from "@/components/ui/status-tag";

const LIST_ERROR = "Não foi possível carregar os contatos.";
const LINK_ONLY = "Só por link";

/** A contact who never signed in has no pending charges to count yet; the tag says why the list stays quiet. */
const PENDING_BADGE = { label: "Ainda não entrou", tone: "neutral" as const };

/** Phone first because it is what a reminder uses; the e-mail is the fallback line, and a person without either only gets the shared link. */
function subtitleOf(contact: Contact): string {
  if (contact.phone) {
    return formatPhoneBR(contact.phone);
  }

  return contact.email || LINK_ONLY;
}

function countLabel(total: number): string {
  return `${total} ${total === 1 ? "contato" : "contatos"}`;
}

function ContactCard({ contact }: { contact: Contact }) {
  const badge = contact.status === "pending" ? PENDING_BADGE : contactBadge(contact.activeCharges);

  return (
    <Link
      href={`/contacts/${contact.id}`}
      aria-label={`Contato ${contact.displayName}`}
      className="flex min-h-16 items-center gap-3 rounded-2xl border border-outline/40 bg-surface p-4 transition hover:border-outline"
    >
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-extrabold text-primary-strong">
        {initialsOf(contact.displayName)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <strong className="min-w-0 flex-1 truncate text-base font-bold text-ink">{contact.displayName}</strong>
          <StatusTag label={badge.label} tone={badge.tone} />
        </span>

        <small className="truncate text-xs text-muted">{subtitleOf(contact)}</small>
      </span>

      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
    </Link>
  );
}

/** The agenda: server-side search, pending badges and a FAB towards the contact form. */
export function ContactsScreen({ returnTo }: { returnTo?: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The form lives on its own screen, so a side trip from the billing draft has
  // to keep travelling: the list hands its own return path to the new contact.
  const newContactHref = returnTo ? `/contacts/new?returnTo=${encodeURIComponent(returnTo)}` : "/contacts/new";

  // Every request carries the version it was born with. A slower `Carregar mais`
  // must not append the previous query's page onto fresh search results, rewind
  // the cursor or clear a spinner nobody is waiting on, so each response checks
  // that it is still the one the screen asked for. Unmounting bumps the counter
  // too, which drops the in-flight request instead of setting state on a dead
  // component.
  const version = useRef(0);

  const load = useCallback(
    (after?: string) => {
      const mine = ++version.current;
      const query = new URLSearchParams({ ...(search ? { search } : {}), ...(after ? { cursor: after } : {}) });

      return browserFetch(`/api/contacts?${query}`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(LIST_ERROR);
          }

          const page = (await response.json()) as ContactsPage;

          if (mine !== version.current) {
            return;
          }

          setContacts(previous => (after ? [...previous, ...page.contacts] : page.contacts));
          setCursor(page.nextCursor);
          setError("");
        })
        .catch((reason: unknown) => {
          if (mine !== version.current) {
            return;
          }

          setError(reason instanceof Error ? reason.message : LIST_ERROR);
        })
        .finally(() => {
          if (mine !== version.current) {
            return;
          }

          setLoading(false);
        });
    },
    [search],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      // A new query starts a new page run: the old cursor belongs to the results
      // it is replacing.
      setCursor(null);
      setSearch(term.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [term]);

  const invalidate = useCallback(() => {
    version.current++;
  }, []);

  useEffect(() => {
    void load();

    return invalidate;
  }, [load, invalidate]);

  return (
    <section className="flex min-h-full flex-col gap-4 pb-24 md:pb-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-2 rounded-2xl border border-outline/40 bg-surface px-4 transition focus-within:border-primary focus-within:outline-[3px] focus-within:outline-primary focus-within:outline-offset-[3px] md:flex-1">
          <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />

          <input
            className="min-h-12 w-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted focus-visible:outline-none"
            type="search"
            aria-label="Buscar contatos"
            placeholder="Buscar por nome ou e-mail..."
            maxLength={254}
            value={term}
            onChange={event => {
              setLoading(true);
              setTerm(event.target.value);
            }}
          />
        </div>

        <div className="flex items-center justify-between md:gap-4">
          <span className="text-xs font-bold tracking-wider text-muted">{countLabel(contacts.length)}</span>
        </div>

        {/* Floats over the list on phones; sits in the heading row once there is room. */}
        <Link
          href={newContactHref}
          className="fixed right-5 bottom-24 z-20 flex h-14 items-center gap-2 rounded-full bg-primary px-5 font-bold text-on-primary shadow-lg transition active:scale-[0.98] md:static md:h-12 md:shadow-none"
        >
          <Plus size={18} aria-hidden="true" />
          Novo contato
        </Link>
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-2xl bg-danger-soft p-4">
          <p role="alert" className="m-0 text-danger">
            {error}
          </p>

          <button type="button" className="flex min-h-11 items-center self-start font-bold text-primary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}

      {loading && !contacts.length && (
        <p role="status" className="m-0 py-6 text-center text-sm text-muted">
          Carregando contatos
        </p>
      )}

      {!loading && !error && !contacts.length && (
        <section className="flex flex-col items-center gap-2 rounded-3xl border border-outline/40 bg-surface p-8">
          <h3 className="m-0 text-lg font-extrabold text-primary-strong">Nenhum contato ainda</h3>
          <p className="m-0 text-center text-sm leading-5 text-muted">Cadastre alguém para dividir despesas e lembrar pagamentos.</p>
        </section>
      )}

      <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2 lg:grid-cols-3">
        {contacts.map(contact => (
          <li key={contact.id}>
            <ContactCard contact={contact} />
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          className="min-h-12 rounded-xl border border-outline font-bold text-primary disabled:opacity-50"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load(cursor);
          }}
        >
          Carregar mais
        </button>
      )}
    </section>
  );
}
