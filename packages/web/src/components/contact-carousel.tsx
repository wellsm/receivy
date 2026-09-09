"use client";

import { lastBilledHint, type Person } from "@receivy/common";
import { Plus } from "lucide-react";

type ContactCarouselProps = {
  people: Person[];
  selected: string[];
  today: string;
  disabled: boolean;
  allowNew: boolean;
  onToggle: (personId: string) => void;
  onNew: () => void;
};

export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

export function ContactCarousel({ people, selected, today, disabled, allowNew, onToggle, onNew }: ContactCarouselProps) {
  return (
    <div className="contact-carousel">
      {allowNew && (
        <button type="button" className="contact-chip is-new" aria-label="Novo contato" disabled={disabled} onClick={onNew}>
          <span className="contact-avatar is-dashed" aria-hidden="true">
            <Plus size={18} aria-hidden="true" />
          </span>
          <strong>Novo</strong>
          <small>Cadastrar</small>
        </button>
      )}
      {people.map(person => (
        <button
          key={person.id}
          type="button"
          className={selected.includes(person.id) ? "contact-chip is-selected" : "contact-chip"}
          aria-pressed={selected.includes(person.id)}
          disabled={disabled}
          onClick={() => onToggle(person.id)}
        >
          <span className="contact-avatar" aria-hidden="true">{initialOf(person.displayName)}</span>
          <strong>{person.displayName}</strong>
          <small>{lastBilledHint(person.lastBilledAt, today)}</small>
        </button>
      ))}
    </div>
  );
}
