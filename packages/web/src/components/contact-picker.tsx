"use client";

import type { Person } from "@receivy/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { initialOf } from "./contact-carousel";

type ContactPickerProps = {
  selected: string[];
  onToggle: (personId: string) => void;
  onSeen: (people: Person[]) => void;
  onClose: () => void;
};

const LOAD_ERROR = "Não foi possível carregar os contatos.";

/** Full agenda in a panel: server-side search plus cursor paging, multi selection. */
export function ContactPicker({ selected, onToggle, onSeen, onClose }: ContactPickerProps) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchField = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(
    (after?: string) => {
      const query = new URLSearchParams({ ...(search ? { search } : {}), ...(after ? { cursor: after } : {}) });

      return browserFetch(`/api/people?${query}`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(LOAD_ERROR);
          }

          const page = (await response.json()) as { people: Person[]; nextCursor: string | null };

          setPeople(previous => (after ? [...previous, ...page.people.filter(person => !previous.some(old => old.id === person.id))] : page.people));
          setCursor(page.nextCursor);
          setError("");
          onSeen(page.people);
        })
        .catch(() => setError(LOAD_ERROR))
        .finally(() => setLoading(false));
    },
    [search, onSeen],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 250);

    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void load();
  }, [load]);

  // The panel takes focus when it opens and hands it back to whatever opened it
  // (the "Ver todos" button) when it closes, so the keyboard never falls to the
  // top of the page.
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchField.current?.focus();
  }, []);

  function close() {
    opener.current?.focus();
    onClose();
  }

  return (
    <div
      className="contact-panel"
      role="dialog"
      aria-label="Contatos"
      aria-modal="false"
      onKeyDown={event => {
        if (event.key !== "Escape") {
          return;
        }

        event.stopPropagation();
        close();
      }}
    >
      <label htmlFor="contact-panel-search">Buscar contatos</label>
      <input
        id="contact-panel-search"
        ref={searchField}
        type="search"
        maxLength={254}
        value={term}
        onChange={event => {
          setLoading(true);
          setTerm(event.target.value);
        }}
      />
      {error && <p className="login-error" role="alert">{error}</p>}
      {loading && <p role="status">Carregando contatos…</p>}
      {!loading && !error && !people.length && <p>Nenhum contato encontrado.</p>}
      <ul className="contact-panel-list">
        {people.map(person => (
          <li key={person.id}>
            <label>
              <input type="checkbox" checked={selected.includes(person.id)} onChange={() => onToggle(person.id)} />
              <span className="contact-avatar" aria-hidden="true">{initialOf(person.name)}</span>
              {person.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="contact-panel-actions">
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
        <button type="button" className="primary-button" onClick={close}>
          Concluir
        </button>
      </div>
    </div>
  );
}
