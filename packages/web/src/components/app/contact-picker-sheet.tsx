"use client";

import type { Contact, ContactsPage } from "@receivy/common";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

type ContactPickerSheetProps = {
  selected: string[];
  /** Receives the account id (`contact.userId`): the draft seats people by account, not by agenda entry. */
  onToggle: (userId: string) => void;
  onSeen: (contacts: Contact[]) => void;
  onClose: () => void;
  /** Absent when the form cannot navigate to the contact form. */
  onNew?: () => void;
  /** The control that opened the panel; focus goes back to it on close. */
  returnFocusTo?: RefObject<HTMLButtonElement | null>;
};

const LOAD_ERROR = "Não foi possível carregar os contatos.";

/** The whole agenda in a dialog: server-side search plus cursor paging, multi selection. */
export function ContactPickerSheet({ selected, onToggle, onSeen, onClose, onNew, returnFocusTo }: ContactPickerSheetProps) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchField = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(
    (after?: string) => {
      const query = new URLSearchParams({ ...(search ? { search } : {}), ...(after ? { cursor: after } : {}) });

      return browserFetch(`/api/contacts?${query}`)
        .then(async response => {
          if (!response.ok) {
            throw new Error(LOAD_ERROR);
          }

          const page = (await response.json()) as ContactsPage;

          setContacts(previous => (after ? [...previous, ...page.contacts.filter(contact => !previous.some(old => old.id === contact.id))] : page.contacts));
          setCursor(page.nextCursor);
          setError("");
          onSeen(page.contacts);
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
  // (the "Adicionar" button) when it closes, so the keyboard never falls to the
  // top of the page.
  useEffect(() => {
    // Captured once: StrictMode runs this effect twice in dev, and by the second
    // pass the search field already holds the focus.
    if (!opener.current) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    searchField.current?.focus();
  }, []);

  function close() {
    (returnFocusTo?.current ?? opener.current)?.focus();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim sm:items-center"
      role="presentation"
      onKeyDown={event => {
        if (event.key !== "Escape") {
          return;
        }

        event.stopPropagation();
        close();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-t-3xl bg-canvas p-5 shadow-2xl sm:rounded-3xl"
        role="dialog"
        aria-label="Contatos"
        aria-modal="true"
      >
        <h2 className="m-0 text-xl font-extrabold text-primary-strong">Contatos</h2>
        <label className="sr-only" htmlFor="contact-panel-search">
          Buscar contatos
        </label>
        <input
          id="contact-panel-search"
          ref={searchField}
          type="search"
          placeholder="Buscar contatos…"
          maxLength={254}
          value={term}
          onChange={event => {
            setLoading(true);
            setTerm(event.target.value);
          }}
          className="min-h-12 rounded-xl border border-outline bg-surface px-4 text-ink"
        />
        {onNew && (
          <button type="button" onClick={onNew} className="min-h-12 rounded-xl border border-dashed border-primary bg-transparent font-bold text-primary">
            + Novo contato
          </button>
        )}
        {error && <p className="m-0 rounded-xl bg-danger-soft p-4 text-danger" role="alert">{error}</p>}
        {loading && <p className="m-0 text-muted" role="status">Carregando contatos…</p>}
        {!loading && !error && !contacts.length && <p className="m-0 py-6 text-muted">Nenhum contato encontrado.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 overflow-y-auto p-0">
          {contacts.map(contact => {
            const checked = selected.includes(contact.userId);

            return (
              <li key={contact.id}>
                <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 ${checked ? "border-primary bg-primary-soft/40" : "border-outline bg-surface"}`}>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(contact.userId)} />
                  <InitialsAvatar name={contact.displayName} size={36} />
                  <span className="flex-1 font-semibold text-ink">{contact.displayName}</span>
                  {checked && <Check size={18} aria-hidden="true" className="text-primary" />}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-2">
          {cursor && (
            <button
              type="button"
              className="min-h-12 rounded-xl border border-outline bg-transparent font-bold text-primary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void load(cursor);
              }}
            >
              Carregar mais
            </button>
          )}
          <button type="button" className="min-h-14 rounded-2xl bg-primary font-bold text-on-primary" onClick={close}>
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
