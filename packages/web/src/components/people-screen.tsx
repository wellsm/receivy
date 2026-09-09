"use client";

import { contactBadge, formatPhoneBR, initialsOf, type PeoplePage, type Person } from "@receivy/common";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";

const LIST_ERROR = "Não foi possível carregar os contatos.";

/** Phone first because it is what a reminder uses; the e-mail is the fallback line. */
function subtitleOf(person: Person): string {
  if (person.phone) {
    return formatPhoneBR(person.phone);
  }

  return person.email ?? "Sem contato";
}

function countLabel(total: number): string {
  return `${total} ${total === 1 ? "contato" : "contatos"}`;
}

export function PeopleScreen({ returnTo }: { returnTo?: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The form lives on its own screen, so a side trip from the billing draft has
  // to keep travelling: the list hands its own return path to the new contact.
  const newContactHref = returnTo ? `/people/new?returnTo=${encodeURIComponent(returnTo)}` : "/people/new";

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

      return browserFetch(`/api/people?${query}`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(LIST_ERROR);
          }

          const page = (await response.json()) as PeoplePage;

          if (mine !== version.current) {
            return;
          }

          setPeople(previous => (after ? [...previous, ...page.people] : page.people));
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
    <section className="financial-page people-page">
      <header className="billings-header">
        <div>
          <h1>Meus Contatos</h1>
          <p>Pessoas com quem você divide contas</p>
        </div>
        <Link className="primary-button billings-new" href={newContactHref}>
          <Plus size={16} aria-hidden="true" />
          Novo contato
        </Link>
      </header>

      <input
        className="billings-search"
        type="search"
        aria-label="Buscar contatos"
        placeholder="Buscar por nome, telefone ou e-mail..."
        maxLength={254}
        value={term}
        onChange={event => {
          setLoading(true);
          setTerm(event.target.value);
        }}
      />

      <div className="people-list-heading">
        <h2 className="profile-section-title">CONTATOS</h2>
        <span className="people-count">{countLabel(people.length)}</span>
      </div>

      {error && (
        <p role="alert" className="login-error">
          {error} <button type="button" onClick={() => void load()}>Tentar novamente</button>
        </p>
      )}

      {loading && !people.length && <p role="status">Carregando contatos…</p>}

      {!loading && !error && !people.length && (
        <section className="billings-empty">
          <h3>Nenhum contato ainda</h3>
          <p>Cadastre alguém para dividir despesas e lembrar pagamentos.</p>
          <Link className="primary-button" href={newContactHref}>
            Novo contato
          </Link>
        </section>
      )}

      <ul className="people-cards">
        {people.map(person => {
          const badge = contactBadge(person.activeCharges);

          return (
            <li key={person.id}>
              <Link className="people-card" href={`/people/${person.id}`} aria-label={`Contato ${person.displayName}`}>
                <span className="person-avatar" aria-hidden="true">
                  {initialsOf(person.displayName)}
                </span>
                <span className="people-card-lines">
                  <span className="people-card-top">
                    <strong>{person.displayName}</strong>
                    <span className={`feed-badge ${badge.tone}`}>{badge.label}</span>
                  </span>
                  <small>{subtitleOf(person)}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>

      {cursor && (
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load(cursor);
          }}
        >
          Carregar mais
        </button>
      )}

      <Link className="fab" href={newContactHref} aria-label="Novo contato">
        <Plus size={22} aria-hidden="true" />
      </Link>
    </section>
  );
}
