"use client";

import { PUSH_DISCLAIMER, REMINDER_MAX_OFFSET, REMINDER_MAX_RULES, type ReminderDraft, reminderOffsetLabel, whatsappLockLabel } from "@receivy/common";
import { Trash2 } from "lucide-react";

type WhatsappGate = { available: boolean; planAllows: boolean };

type ReminderEditorProps = {
  rules: ReminderDraft[];
  onChange: (rules: ReminderDraft[]) => void;
  whatsapp: WhatsappGate;
  disabled?: boolean;
};

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold";
const CHIP_ON = `${CHIP} border-primary bg-primary-soft text-primary-strong`;
const CHIP_OFF = `${CHIP} border-outline text-muted`;

function ChannelChip({ label, checked, locked, disabled, name, onChange }: { label: string; checked: boolean; locked: string | null; disabled?: boolean; name: string; onChange: (value: boolean) => void }) {
  const off = disabled || locked !== null;

  return (
    <label className={`${checked && !locked ? CHIP_ON : CHIP_OFF} ${off ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" className="sr-only" aria-label={name} checked={checked && !locked} disabled={off} onChange={event => onChange(event.target.checked)} />
      {label}
      {locked && <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted">{locked}</span>}
    </label>
  );
}

export function ReminderEditor({ rules, onChange, whatsapp, disabled }: ReminderEditorProps) {
  const lock = whatsappLockLabel(whatsapp);

  function patch(index: number, next: Partial<ReminderDraft>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  }

  function add() {
    if (rules.length >= REMINDER_MAX_RULES) {
      return;
    }

    onChange([...rules, { offsetDays: "", enabled: true, channels: { email: true, whatsapp: false } }]);
  }

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule, index) => {
        const offset = Number(rule.offsetDays);
        const human = rule.offsetDays === "" || Number.isNaN(offset) ? "" : reminderOffsetLabel(offset);

        return (
          <div key={index} className="flex flex-col gap-2.5 rounded-xl border border-outline/30 bg-surface px-3 py-2.5">
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                min={-REMINDER_MAX_OFFSET}
                max={REMINDER_MAX_OFFSET}
                aria-label={`Dias do lembrete ${index + 1}`}
                className="h-9 w-20 rounded-lg border border-outline bg-canvas px-2 text-sm text-ink"
                value={rule.offsetDays}
                disabled={disabled}
                onChange={event => patch(index, { offsetDays: event.target.value })}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{human}</span>
              <input type="checkbox" role="switch" aria-label={`Lembrete ${index + 1} ativo`} className="h-5 w-5 accent-primary" checked={rule.enabled} disabled={disabled} onChange={event => patch(index, { enabled: event.target.checked })} />
              <button type="button" aria-label={`Remover lembrete ${index + 1}`} className="text-muted" disabled={disabled || rules.length === 1} onClick={() => onChange(rules.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <ChannelChip label="E-mail" name={`E-mail no lembrete ${human || index + 1}`} checked={rule.channels.email} locked={null} disabled={disabled} onChange={value => patch(index, { channels: { ...rule.channels, email: value } })} />
              <ChannelChip label="WhatsApp" name={`WhatsApp no lembrete ${human || index + 1}`} checked={rule.channels.whatsapp} locked={lock} disabled={disabled} onChange={value => patch(index, { channels: { ...rule.channels, whatsapp: value } })} />
            </div>
          </div>
        );
      })}

      {rules.length < REMINDER_MAX_RULES && (
        <button type="button" className="self-start text-sm font-semibold text-primary" disabled={disabled} onClick={add}>
          Adicionar lembrete
        </button>
      )}

      <p className="m-0 text-[11px] text-muted">{PUSH_DISCLAIMER}</p>
    </div>
  );
}

export function ManualChannels({ value, onChange, whatsapp, disabled }: { value: { email: boolean; whatsapp: boolean }; onChange: (value: { email: boolean; whatsapp: boolean }) => void; whatsapp: WhatsappGate; disabled?: boolean }) {
  const lock = whatsappLockLabel(whatsapp);

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[11px] text-muted">É o que sai quando você toca em Lembrar</p>
      <div className="flex flex-wrap gap-2">
        <ChannelChip label="E-mail" name="E-mail no lembrete manual" checked={value.email} locked={null} disabled={disabled} onChange={email => onChange({ ...value, email })} />
        <ChannelChip label="WhatsApp" name="WhatsApp no lembrete manual" checked={value.whatsapp} locked={lock} disabled={disabled} onChange={whatsapp => onChange({ ...value, whatsapp })} />
      </div>
    </div>
  );
}
