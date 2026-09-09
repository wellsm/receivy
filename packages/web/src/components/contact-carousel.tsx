"use client";

import type { Person } from "@receivy/common";
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

function dayDiff(date: string, today: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);

  return Math.round((Date.UTC(todayYear!, todayMonth! - 1, todayDay!) - Date.UTC(year!, month! - 1, day!)) / 86_400_000);
}

/** Short hint under a contact: how long since the last billing that involved them. */
export function lastBilledHint(lastBilledAt: string | null, today: string): string {
  if (!lastBilledAt) {
    return "Sem cobranças";
  }

  const days = dayDiff(lastBilledAt.slice(0, 10), today);

  if (days <= 0) {
    return "Hoje";
  }

  if (days === 1) {
    return "Ontem";
  }

  if (days < 7) {
    return `${days}d`;
  }

  if (days < 30) {
    return `${Math.floor(days / 7)}sem`;
  }

  return `${Math.floor(days / 30)}m`;
}

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
          <span className="contact-avatar" aria-hidden="true">{initialOf(person.name)}</span>
          <strong>{person.name}</strong>
          <small>{lastBilledHint(person.lastBilledAt, today)}</small>
        </button>
      ))}
    </div>
  );
}
