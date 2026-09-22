"use client";

import {
  CHANNEL_SET_OPTIONS,
  channelSetLabel,
  PUSH_DISCLAIMER,
  REMINDER_MAX_OFFSET,
  REMINDER_MAX_RULES,
  REMINDER_OFFSET_MODE_LABELS,
  type ChannelSet,
  type ReminderDraft,
  reminderOffsetDays,
  reminderOffsetLabel,
  ReminderOffsetMode,
  reminderOffsetMode,
  reminderPreviewLine,
  shortDayMonth,
  whatsappLockLabel,
} from "@receivy/common";
import { Trash2 } from "lucide-react";
import { useState } from "react";

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderEditorProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

/** Which panel a card has open: the days picker, the channel picker, or neither. */
type OpenPanel = { index: number; panel: "days" | "channels" } | null;

const MODES = [ReminderOffsetMode.Before, ReminderOffsetMode.Due, ReminderOffsetMode.After];

const PILL = "inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-[13px] font-bold";
const PILL_ON = `${PILL} border-primary bg-primary text-primary-foreground`;
const PILL_SOFT = `${PILL} border-primary/40 bg-primary-soft text-primary-strong`;
const PILL_MUTED = `${PILL} border-outline bg-surface-muted text-ink`;

const WORD = "text-[14.5px] text-muted";

function offsetOf(rule: ReminderDraft): number {
  const parsed = Number(rule.offsetDays);

  return rule.offsetDays === "" || Number.isNaN(parsed) ? 0 : parsed;
}

export function ReminderEditor({ rules, onChange, whatsapp, disabled }: ReminderEditorProps) {
  const [open, setOpen] = useState<OpenPanel>(null);
  const lock = whatsappLockLabel(whatsapp);

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function toggle(index: number, panel: "days" | "channels") {
    setOpen(open?.index === index && open.panel === panel ? null : { index, panel });
  }

  function add() {
    if (rules.length >= REMINDER_MAX_RULES) {
      return;
    }

    const taken = new Set(rules.map(rule => offsetOf(rule)));
    const free = [0, -3, 2, -1, 1, -7, 7, -14, 14].find(day => !taken.has(day)) ?? 0;

    onChange([...rules, { offsetDays: String(free), enabled: true, channels: { email: true, whatsapp: false } }]);
    setOpen({ index: rules.length, panel: "days" });
  }

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule, index) => {
        const offset = offsetOf(rule);
        const mode = reminderOffsetMode(offset);
        const days = Math.abs(offset);
        const position = index + 1;
        const opened = open?.index === index ? open.panel : null;

        function setOffset(next: number) {
          patch(index, { offsetDays: String(next) });
        }

        return (
          <div key={index} className={`flex flex-col rounded-[20px] border bg-surface p-4 ${opened ? "border-primary shadow-sm" : "border-outline"}`}>
            <div className="flex flex-wrap items-center gap-[7px]">
              <span className={WORD}>Avisar</span>

              <button
                type="button"
                aria-label={`Quando avisar no lembrete ${position}`}
                aria-expanded={opened === "days"}
                className={opened === "days" ? PILL_ON : PILL_SOFT}
                disabled={disabled}
                onClick={() => toggle(index, "days")}
              >
                {reminderOffsetLabel(offset)}
              </button>

              <span className={WORD}>por</span>

              <button
                type="button"
                aria-label={`Canais do lembrete ${position}`}
                aria-expanded={opened === "channels"}
                className={opened === "channels" ? PILL_ON : PILL_MUTED}
                disabled={disabled}
                onClick={() => toggle(index, "channels")}
              >
                {channelSetLabel(rule.channels)}
              </button>

              <span className="ml-auto flex items-center gap-3">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Lembrete ${position} ativo`}
                  className="h-5 w-5 accent-primary"
                  checked={rule.enabled}
                  disabled={disabled}
                  onChange={event => patch(index, { enabled: event.target.checked })}
                />
                <button
                  type="button"
                  aria-label={`Remover lembrete ${position}`}
                  className="text-muted"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(null);
                    onChange(rules.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </span>
            </div>

            {opened === "days" ? (
              <div className="mt-3.5 border-t border-outline/50 pt-3.5">
                <div role="radiogroup" aria-label={`Quando avisar no lembrete ${position}`} className="flex gap-1.5 rounded-xl bg-surface-muted p-[3px]">
                  {MODES.map(option => {
                    const active = option === mode;

                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`${REMINDER_OFFSET_MODE_LABELS[option]} no lembrete ${position}`}
                        className={`h-[34px] flex-1 rounded-[9px] text-xs font-semibold ${active ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
                        disabled={disabled}
                        onClick={() => setOffset(reminderOffsetDays(option, days))}
                      >
                        {REMINDER_OFFSET_MODE_LABELS[option]}
                      </button>
                    );
                  })}
                </div>

                <div className={`mt-2.5 flex items-center gap-2.5 ${mode === ReminderOffsetMode.Due ? "opacity-40" : ""}`}>
                  <button
                    type="button"
                    aria-label={`Menos um dia no lembrete ${position}`}
                    className="h-9 w-9 rounded-[11px] border border-outline font-display text-base font-bold text-muted"
                    disabled={disabled || mode === ReminderOffsetMode.Due || days <= 1}
                    onClick={() => setOffset(reminderOffsetDays(mode, days - 1))}
                  >
                    –
                  </button>

                  <div className="flex-1 text-center">
                    <div className="font-display text-lg font-bold text-ink">{mode === ReminderOffsetMode.Due ? 0 : days}</div>
                    <div className="text-[10.5px] text-muted">dias</div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Mais um dia no lembrete ${position}`}
                    className="h-9 w-9 rounded-[11px] border border-outline font-display text-base font-bold text-muted"
                    disabled={disabled || mode === ReminderOffsetMode.Due || days >= REMINDER_MAX_OFFSET}
                    onClick={() => setOffset(reminderOffsetDays(mode, days + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
            ) : null}

            {opened === "channels" ? (
              <div role="radiogroup" aria-label={`Canais do lembrete ${position}`} className="mt-3.5 flex flex-col gap-1.5 border-t border-outline/50 pt-3.5">
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
                      aria-label={`${label} no lembrete ${position}`}
                      className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold ${active ? "border-primary bg-primary-soft text-primary-strong" : "border-outline text-ink"} ${locked ? "opacity-60" : ""}`}
                      disabled={disabled || locked !== null}
                      onClick={() => {
                        patch(index, { channels: { ...option } });
                        setOpen(null);
                      }}
                    >
                      {label}
                      {locked ? <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted">{locked}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        {rules.length < REMINDER_MAX_RULES ? (
          <button type="button" className="text-sm font-semibold text-primary" disabled={disabled} onClick={add}>
            E também avisar…
          </button>
        ) : (
          <span className="text-sm text-muted">Limite de lembretes atingido</span>
        )}

        <span className="text-[11px] font-semibold text-muted">
          {rules.length} de {REMINDER_MAX_RULES}
        </span>
      </div>

      <p className="m-0 text-[11px] text-muted">{PUSH_DISCLAIMER}</p>
    </div>
  );
}

/** The preview block under the cards: the dates the rules land on, against a real or example due date. */
export function ReminderPreview({ rules, dueDate }: { rules: ReminderDraft[]; dueDate: string }) {
  const parsed = rules.map(rule => ({ ...rule, offsetDays: offsetOf(rule) }));

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-outline bg-surface-muted px-4 py-3">
      <span className="text-[10px] font-bold tracking-[0.08em] text-muted">PRÉVIA · VENCIMENTO {shortDayMonth(dueDate)}</span>
      <span className="text-[12.5px] leading-relaxed text-ink">{reminderPreviewLine(parsed, dueDate)}</span>
    </div>
  );
}

export function ManualChannels({ value, onChange, whatsapp, disabled }: { value: ChannelSet; onChange: (value: ChannelSet) => void; whatsapp: WhatsappGate; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const lock = whatsappLockLabel(whatsapp);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-[7px]">
        <span className={WORD}>Quando eu toco em Lembrar</span>
        <button type="button" aria-label="Canais do lembrete manual" aria-expanded={open} className={open ? PILL_ON : PILL_MUTED} disabled={disabled} onClick={() => setOpen(!open)}>
          {channelSetLabel(value)}
        </button>
      </div>

      {open ? (
        <div role="radiogroup" aria-label="Canais do lembrete manual" className="flex flex-col gap-1.5">
          {CHANNEL_SET_OPTIONS.map(option => {
            const label = channelSetLabel(option);
            const locked = option.whatsapp ? lock : null;
            const active = option.email === value.email && option.whatsapp === value.whatsapp;

            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${label} no lembrete manual`}
                className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold ${active ? "border-primary bg-primary-soft text-primary-strong" : "border-outline text-ink"} ${locked ? "opacity-60" : ""}`}
                disabled={disabled || locked !== null}
                onClick={() => {
                  onChange({ ...option });
                  setOpen(false);
                }}
              >
                {label}
                {locked ? <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted">{locked}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
