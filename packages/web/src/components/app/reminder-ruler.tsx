"use client";

import {
  CHANNEL_SET_OPTIONS,
  channelSetLabel,
  REMINDER_MAX_OFFSET,
  REMINDER_MAX_RULES,
  type ReminderDraft,
  reminderOffsetLabel,
  shiftDays,
  shortDayMonth,
  whatsappLockLabel,
} from "@receivy/common";
import { Bell, Mail, MessageCircle } from "lucide-react";
import { useRef, useState } from "react";

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderRulerProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

/** Where a free slot is offered on the ruler, in the order the picker fills them. */
const SUGGESTED = [-14, -7, -3, -1, 1, 2, 3, 7, 14];

const MIN_OFFSET = -REMINDER_MAX_OFFSET;

const HINT = "Toque num ponto cinza para criar, arraste para mover, toque no índigo para editar.";

function offsetOf(rule: ReminderDraft): number {
  const parsed = Number(rule.offsetDays);

  return rule.offsetDays === "" || Number.isNaN(parsed) ? 0 : parsed;
}

/** The ruler spans ±14 days, with the due date in the middle. */
function percentOf(offset: number): number {
  return ((offset + REMINDER_MAX_OFFSET) / (REMINDER_MAX_OFFSET * 2)) * 100;
}

function offsetAt(ratio: number): number {
  const raw = Math.round(ratio * REMINDER_MAX_OFFSET * 2) - REMINDER_MAX_OFFSET;

  return Math.min(REMINDER_MAX_OFFSET, Math.max(-REMINDER_MAX_OFFSET, raw));
}

/** What a row says under its title: the configured channels plus the implicit push, or that it is paused. */
function rowSubtitle(rule: ReminderDraft): string {
  if (!rule.enabled) {
    return "pausado";
  }

  const names = [...(rule.channels.email ? ["e-mail"] : []), ...(rule.channels.whatsapp ? ["WhatsApp"] : []), "push"];

  return names.join(" · ");
}

export function ReminderRuler({ rules, onChange, whatsapp, disabled }: ReminderRulerProps) {
  const track = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const lock = whatsappLockLabel(whatsapp);

  const ordered = rules.map((rule, index) => ({ rule, index, offset: offsetOf(rule) })).sort((a, b) => a.offset - b.offset);
  const taken = new Set(ordered.map(item => item.offset));
  const free = SUGGESTED.filter(day => !taken.has(day));

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function moveTo(index: number, offset: number) {
    if (taken.has(offset) && offsetOf(rules[index]!) !== offset) {
      return;
    }

    patch(index, { offsetDays: String(offset) });
  }

  function create(offset: number) {
    if (rules.length >= REMINDER_MAX_RULES || taken.has(offset)) {
      return;
    }

    onChange([...rules, { offsetDays: String(offset), enabled: true, channels: { email: true, whatsapp: false } }]);
  }

  function drag(index: number) {
    if (disabled) {
      return;
    }

    function move(event: PointerEvent) {
      const box = track.current?.getBoundingClientRect();

      if (!box || box.width === 0) {
        return;
      }

      moveTo(index, offsetAt((event.clientX - box.left) / box.width));
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-[20px] border border-outline bg-surface p-4 pb-[18px]">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-muted">QUANDO AVISAR</span>
          <span className="text-[11px] font-semibold text-muted">
            {rules.length} de {REMINDER_MAX_RULES}
          </span>
        </div>

        <div ref={track} className="relative mt-5 h-[66px]">
          <div className="absolute inset-x-0 top-[30px] h-0.5 bg-outline" />
          <div className="absolute inset-y-3.5 left-1/2 -ml-px w-0.5 bg-ink" />
          <span className="absolute left-1/2 top-0 flex h-[18px] -translate-x-1/2 items-center whitespace-nowrap rounded-md bg-ink px-[7px] text-[9.5px] font-bold tracking-[0.06em] text-canvas">VENCIMENTO</span>

          {free.map(day => (
            <button
              key={day}
              type="button"
              aria-label={`Criar lembrete ${reminderOffsetLabel(day)}`}
              className="absolute top-[22px] -ml-2 h-4 w-4 rounded-full"
              style={{ left: `${percentOf(day)}%` }}
              disabled={disabled || rules.length >= REMINDER_MAX_RULES}
              onClick={() => create(day)}
            >
              <span className="mx-auto block h-[7px] w-[7px] rounded-full bg-outline" />
            </button>
          ))}

          {ordered.map(({ index, offset }) => (
            <div key={index} className="absolute top-[23px]" style={{ left: `${percentOf(offset)}%` }}>
              <button
                type="button"
                role="slider"
                aria-label={`Lembrete ${index + 1}`}
                aria-valuemin={MIN_OFFSET}
                aria-valuemax={REMINDER_MAX_OFFSET}
                aria-valuenow={offset}
                aria-valuetext={reminderOffsetLabel(offset)}
                className="-ml-2 h-4 w-4 rounded-full border-[3px] border-canvas bg-primary ring-1 ring-primary"
                disabled={disabled}
                onPointerDown={() => drag(index)}
                onClick={() => setEditing(editing === index ? null : index)}
                onKeyDown={event => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    moveTo(index, Math.max(MIN_OFFSET, offset - 1));
                  }

                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    moveTo(index, Math.min(REMINDER_MAX_OFFSET, offset + 1));
                  }
                }}
              />
              <span className="absolute top-[23px] left-0 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-semibold text-primary">{reminderOffsetLabel(offset)}</span>
            </div>
          ))}
        </div>

        <div className="mt-1.5 flex justify-between text-[10px] font-medium text-muted">
          <span>14 dias antes</span>
          <span>14 dias depois</span>
        </div>

        <p className="m-0 mt-3 text-[11.5px] leading-normal text-muted">{HINT}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="px-1 text-[11px] font-semibold tracking-[0.08em] text-muted">
          {rules.length === 1 ? "O AVISO" : `OS ${rules.length} AVISOS`}
        </span>

        <div className="overflow-hidden rounded-[20px] border border-outline bg-surface">
          {ordered.map(({ rule, index, offset }, position) => (
            <div key={index} className={position === 0 ? "" : "border-t border-outline/50"}>
              <div className="flex items-center gap-[11px] px-4 py-3">
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-primary-soft font-display text-[11px] font-bold text-primary-strong">{position + 1}</span>

                <button type="button" aria-label={`Editar lembrete ${index + 1}`} aria-expanded={editing === index} className="min-w-0 flex-1 text-left" disabled={disabled} onClick={() => setEditing(editing === index ? null : index)}>
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{reminderOffsetLabel(offset)}</span>
                  <span className="block truncate text-[11px] text-muted">{rowSubtitle(rule)}</span>
                </button>

                {rule.channels.email ? <Mail aria-hidden="true" size={15} className="shrink-0 text-muted" /> : null}
                {rule.channels.whatsapp ? <MessageCircle aria-hidden="true" size={15} className="shrink-0 text-muted" /> : null}
                <Bell aria-hidden="true" size={15} className="shrink-0 text-muted" />

                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Lembrete ${index + 1} ativo`}
                  className="h-5 w-5 shrink-0 accent-primary"
                  checked={rule.enabled}
                  disabled={disabled}
                  onChange={event => patch(index, { enabled: event.target.checked })}
                />
              </div>

              {editing === index ? (
                <div className="flex flex-col gap-1.5 px-4 pb-3.5">
                  <div role="radiogroup" aria-label={`Canais do lembrete ${index + 1}`} className="flex flex-col gap-1.5">
                    {CHANNEL_SET_OPTIONS.map(option => {
                      const label = channelSetLabel(option);
                      const locked = option.whatsapp ? lock : null;
                      const active = option.email === rule.channels.email && option.whatsapp === rule.channels.whatsapp;

                      return (
                        <button
                          key={label}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={`${label} no lembrete ${index + 1}`}
                          className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold ${active ? "border-primary bg-primary-soft text-primary-strong" : "border-outline text-ink"} ${locked ? "opacity-60" : ""}`}
                          disabled={disabled || locked !== null}
                          onClick={() => patch(index, { channels: { ...option } })}
                        >
                          {label}
                          {locked ? <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted">{locked}</span> : null}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    aria-label={`Remover lembrete ${index + 1}`}
                    className="self-start text-[13px] font-semibold text-danger"
                    disabled={disabled}
                    onClick={() => {
                      setEditing(null);
                      onChange(rules.filter((_, i) => i !== index));
                    }}
                  >
                    Remover
                  </button>
                </div>
              ) : null}
            </div>
          ))}

          {!rules.length ? <p className="m-0 px-4 py-3 text-[13px] text-muted">Nenhum lembrete. Toque num ponto da régua.</p> : null}
        </div>
      </div>
    </div>
  );
}

const PREVIEW_NOTE = "Sempre às 6h no fuso da conta. Push sai junto sempre que a pessoa tiver o app.";

/** 5a dates each enabled rule as its own chip, weekday included, against the due date. */
export function RulerPreview({ rules, dueDate }: { rules: ReminderDraft[]; dueDate: string }) {
  const format = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  const days = rules
    .filter(rule => rule.enabled)
    .map(rule => offsetOf(rule))
    .sort((a, b) => a - b)
    .map(offset => format.format(new Date(`${shiftDays(dueDate, offset)}T00:00:00Z`)).replace(/\.$/, ""));

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-outline bg-surface-muted px-4 py-3">
      <span className="text-[10px] font-bold tracking-[0.08em] text-muted">PRÉVIA · VENCIMENTO {shortDayMonth(dueDate)}</span>

      {days.length ? (
        <div className="flex flex-wrap gap-1.5">
          {days.map(day => (
            <span key={day} className="rounded-lg border border-outline bg-surface px-2 py-1 text-[11.5px] font-semibold text-ink">
              {day}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[12.5px] text-ink">Nenhum lembrete automático.</span>
      )}

      <span className="text-[11px] text-muted">{PREVIEW_NOTE}</span>
    </div>
  );
}
