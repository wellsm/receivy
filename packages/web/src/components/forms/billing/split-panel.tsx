"use client";

import { type BillingDraft, type Contact, formatMoney, groupNoticeNote, SplitMode, splitModeBadge, type UserAvatar } from "@receivy/common";
import { Bell, BellOff, Plus, Users, X } from "lucide-react";
import type { RefObject } from "react";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

/** The segmented control shows the short label; the accessible name keeps the full one. */
export const SPLIT_MODES: { value: SplitMode; label: string; name: string }[] = [
  { value: SplitMode.Equal, label: "Igual", name: "Igual" },
  { value: SplitMode.Shares, label: "Cotas", name: "Cotas" },
  { value: SplitMode.Percentage, label: "%", name: "Porcentagem" },
  { value: SplitMode.Fixed, label: "Fixo", name: "Valor fixo" },
];

const FIELD_LABELS: Record<Exclude<SplitMode, "equal">, string> = {
  shares: "Cotas",
  fixed: "Valor",
  percentage: "Porcentagem",
};

export const BELL_NOTE = "Sino riscado = sem aviso automático";

/** One line of the Divisão panel: a participant, or the owner as "Eu". */
export type SplitPerson = {
  /** The contact's account id, or `owner`. */
  key: string;
  name: string;
  /** Under the name: the e-mail, or why nothing reaches this person. */
  subtitle: string;
  avatar?: UserAvatar | null;
  owner: boolean;
  /** What the split gives this person; absent while the screen cannot be priced. */
  amountCents?: number;
  /** The typed value for the current mode (shares, percent or amount). */
  value: string;
  /** Whether an automatic notice can reach this person at all. */
  notifiable: boolean;
  /** Whether it will: the bell. */
  notify: boolean;
  /** A read-only line instead of a field: the owner's remainder on a fixed split. */
  readonlyText?: string;
};

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

function Stepper({ name, value, disabled, onChange }: { name: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const count = Number(value) || 1;

  return (
    <div className={`flex h-9 items-center rounded-xl border border-outline bg-surface ${disabled ? "opacity-50" : ""}`}>
      <button type="button" aria-label={`Menos cotas de ${name}`} disabled={disabled || count <= 1} onClick={() => onChange(String(count - 1))} className="h-9 w-8 bg-transparent text-base font-bold text-primary-strong disabled:opacity-40">
        –
      </button>
      <input aria-label={`Cotas de ${name}`} inputMode="numeric" placeholder="1" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-8 border-0 bg-transparent p-0 text-center text-[14px] font-bold text-ink outline-none" />
      <button type="button" aria-label={`Mais cotas de ${name}`} disabled={disabled} onClick={() => onChange(String(count + 1))} className="h-9 w-8 bg-transparent text-base font-bold text-primary-strong">
        +
      </button>
    </div>
  );
}

type SplitPanelProps = {
  draft: BillingDraft;
  people: SplitPerson[];
  /** What is missing for the split to close, or empty. */
  hint: string;
  /** "5 cotas · R$ 10,78 cada", under the rows. */
  footer: string;
  disabled: boolean;
  addRef?: RefObject<HTMLButtonElement | null>;
  onMode: (mode: SplitMode) => void;
  onValue: (key: string, value: string) => void;
  onNotify: (key: string, notify: boolean) => void;
  onRemove: (key: string) => void;
  onOwner: (participates: boolean) => void;
  onAdd: () => void;
  /** The "Escolher grupo" button, so the group dialog gives the focus back to it. */
  groupRef?: RefObject<HTMLButtonElement | null>;
  /** Present when the owner's own WhatsApp is connected: the notices can go to a group instead. */
  group?: {
    current: { name: string } | null;
    onPick: () => void;
    onClear: () => void;
  };
};

/** "Avisar no grupo": off, it offers the picker; on, it names the group and lets it go. */
function GroupRow({ group, pickRef, disabled }: { group: NonNullable<SplitPanelProps["group"]>; pickRef?: RefObject<HTMLButtonElement | null>; disabled: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-outline bg-surface px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
        <Users size={17} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[11.5px] text-muted">Avisar no grupo</span>
        <span className="truncate text-[14px] font-bold text-ink">{group.current ? group.current.name : "Cada pessoa no privado"}</span>
      </span>
      {group.current && (
        <button type="button" aria-label="Avisar cada pessoa" disabled={disabled} onClick={group.onClear} className="flex h-9 w-7 items-center justify-center bg-transparent text-muted disabled:opacity-50">
          <X size={14} aria-hidden="true" />
        </button>
      )}
      <button ref={pickRef} type="button" aria-label="Escolher grupo" disabled={disabled} onClick={group.onPick} className="min-h-9 bg-transparent px-1 text-[13px] font-bold text-primary disabled:opacity-50">
        {group.current ? "Trocar" : "Escolher"}
      </button>
    </div>
  );
}

/** The second column of the creation and the Divisão dialog of the edit: the mode tabs, one row per person, Eu with its switch. */
export function SplitPanel({ draft, people, hint, footer, disabled, addRef, onMode, onValue, onNotify, onRemove, onOwner, onAdd, groupRef, group }: SplitPanelProps) {
  // A group carries the notice: the bells say nothing while it does.
  const grouped = Boolean(group?.current);
  const keys = people.filter((person) => !person.owner || draft.owner).map((person) => person.key);
  const badge = splitModeBadge(draft, keys);
  const bells = !grouped && people.some((person) => !person.owner && person.notifiable);

  return (
    <div className="flex flex-col gap-3">
      <div className={`flex rounded-[14px] bg-surface-muted p-1 ${disabled ? "opacity-60" : ""}`} role="radiogroup" aria-label="Divisão">
        {SPLIT_MODES.map((option) => {
          const active = draft.mode === option.value;

          return (
            <label key={option.value} className={`flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[11px] text-[13px] ${active ? "bg-surface font-bold text-ink shadow-sm" : "font-semibold text-muted"}`}>
              <input type="radio" className="sr-only" name="billing-split" value={option.value} aria-label={option.name} checked={active} disabled={disabled} onChange={() => onMode(option.value)} />
              <span aria-hidden="true">{option.label}</span>
              {active && badge !== null && <span className="min-w-[22px] rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-bold text-on-primary">{badge}</span>}
            </label>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[18px] border border-outline bg-surface">
        <div className="hidden items-center gap-2.5 border-b border-outline/60 bg-surface-muted/60 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted md:flex">
          <span className="flex-1">Pessoa</span>
          <span>{draft.mode === SplitMode.Equal ? "" : FIELD_LABELS[draft.mode]}</span>
          <span className="w-[84px] text-right">Valor</span>
          <span className="w-[74px] text-center">Aviso</span>
        </div>
        <ul className="m-0 list-none p-0">
          {people.map((person, index) => {
            const out = person.owner && !draft.owner;
            const amount = person.amountCents !== undefined && !out ? money(person.amountCents) : "";
            const bellOn = person.notifiable && !grouped;

            return (
              <li key={person.key} className={`flex min-h-[60px] items-center gap-2.5 px-3 py-2 ${index ? "border-t border-outline/60" : ""} ${out ? "opacity-50" : ""}`}>
                {person.owner ? <InitialsAvatar name="Eu" size={32} inverted /> : <InitialsAvatar name={person.name} size={32} avatar={person.avatar} />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-bold text-ink">{person.name}</span>
                    {person.owner && <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[9.5px] font-bold text-muted">VOCÊ</span>}
                  </span>
                  {person.readonlyText ? (
                    <span className="text-[12px] font-semibold text-primary-strong">{person.readonlyText}</span>
                  ) : (
                    <>
                      <span className="hidden truncate text-[12px] text-muted md:block">{person.subtitle}</span>
                      {amount && <span className="text-[12.5px] text-muted tabular-nums md:hidden">{amount}</span>}
                    </>
                  )}
                </span>

                {!person.readonlyText && !out && draft.mode === SplitMode.Shares && <Stepper name={person.name} value={person.value} disabled={disabled} onChange={(value) => onValue(person.key, value)} />}
                {!person.readonlyText && !out && (draft.mode === SplitMode.Percentage || draft.mode === SplitMode.Fixed) && (
                  <span className="flex items-center gap-1">
                    <input
                      aria-label={`${FIELD_LABELS[draft.mode]} de ${person.name}`}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={disabled}
                      value={person.value}
                      onChange={(event) => onValue(person.key, event.target.value)}
                      className={`h-9 rounded-xl border border-outline bg-surface px-2 text-right text-[14px] font-bold text-ink outline-none ${draft.mode === SplitMode.Fixed ? "w-24" : "w-14"}`}
                    />
                    {draft.mode === SplitMode.Percentage && <span className="text-xs text-muted">%</span>}
                  </span>
                )}

                <span className="hidden w-[84px] text-right font-display text-[14px] font-bold text-ink tabular-nums md:block">{person.readonlyText ? "" : amount}</span>

                {/* One fixed column for the bell and × or the owner's switch, so every field above it lines up. */}
                <span className="flex w-[74px] shrink-0 items-center justify-end gap-2.5">
                  {person.owner ? (
                    <label className="flex w-full cursor-pointer flex-col items-center gap-0.5 text-[10px] font-semibold text-muted">
                      <input type="checkbox" role="switch" aria-label="Eu também participo" className="peer sr-only" disabled={disabled} checked={draft.owner} onChange={(event) => onOwner(event.target.checked)} />
                      <span
                        aria-hidden="true"
                        className="relative h-5 w-[34px] rounded-full bg-outline transition after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-surface after:shadow-sm after:transition peer-checked:bg-primary peer-checked:after:translate-x-[14px] peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 peer-disabled:opacity-50"
                      />
                      participo
                    </label>
                  ) : (
                    <>
                      {/* Always there; with no channel, or while a group carries the notice, it stays dimmer than a plain disabled control. */}
                      <button
                        type="button"
                        role="switch"
                        aria-label={`Avisar ${person.name}`}
                        aria-checked={bellOn && person.notify}
                        disabled={disabled || !bellOn}
                        onClick={() => onNotify(person.key, !person.notify)}
                        className={`flex h-9 w-9 items-center justify-center rounded-xl ${bellOn && person.notify ? "bg-primary-soft text-primary-strong" : "bg-surface-muted text-muted"} ${bellOn ? "disabled:opacity-50" : "opacity-30"}`}
                      >
                        {bellOn && person.notify ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
                      </button>
                      <button type="button" aria-label={`Remover ${person.name}`} disabled={disabled} onClick={() => onRemove(person.key)} className="flex h-9 w-7 items-center justify-center bg-transparent text-muted disabled:opacity-50">
                        <X size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <button ref={addRef} type="button" aria-label="Adicionar" disabled={disabled} onClick={onAdd} className="flex min-h-[52px] w-full items-center gap-2.5 border-t border-outline/60 bg-transparent px-3 text-left text-[13.5px] font-bold text-primary disabled:opacity-50">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-primary">
            <Plus size={13} aria-hidden="true" />
          </span>
          Adicionar pessoa
        </button>
      </div>

      {group && <GroupRow group={group} pickRef={groupRef} disabled={disabled} />}
      {group?.current && <p className="m-0 text-[12px] leading-4 text-muted">{groupNoticeNote(group.current.name)}</p>}

      {hint && <p className="m-0 rounded-xl bg-danger-soft px-3 py-2.5 text-[12.5px] font-semibold text-danger">{hint}</p>}

      {(footer || bells) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>{footer}</span>
          {bells && <span>{BELL_NOTE}</span>}
        </div>
      )}
    </div>
  );
}

type SeatPanelProps = {
  /** "Para quem" on a conta a pagar, "De quem" on a registro a receber. */
  label: string;
  hint: string;
  seated: Contact | null;
  /** The seat of a registro never moves once created. */
  locked: boolean;
  disabled: boolean;
  pickRef?: RefObject<HTMLButtonElement | null>;
  onPick: () => void;
};

/** The other side of a conta a pagar or a registro: one contact, picked from the agenda. Once seated it is only swapped, never emptied. */
export function SeatPanel({ label, hint, seated, locked, disabled, pickRef, onPick }: SeatPanelProps) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={disabled}>
      <legend className="ml-0.5 p-0 text-[11px] font-semibold uppercase tracking-[0.08em] leading-10 text-muted">{label}</legend>

      {seated ? (
        <div className="flex min-h-[60px] items-center gap-2.5 rounded-[18px] border border-outline bg-surface px-3 py-2">
          <InitialsAvatar name={seated.displayName} size={32} avatar={seated.avatar} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{seated.displayName}</span>
          {!locked && (
            <button ref={pickRef} type="button" aria-label={`Trocar ${seated.displayName}`} onClick={onPick} className="min-h-9 bg-transparent px-1 text-[13px] font-bold text-primary">
              Trocar
            </button>
          )}
        </div>
      ) : (
        <button ref={pickRef} type="button" aria-label="Adicionar" onClick={onPick} className="flex min-h-[60px] w-full items-center gap-2.5 rounded-[18px] border border-dashed border-primary/60 bg-surface px-3 text-left">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-primary text-primary">
            <Plus size={13} aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13.5px] font-bold text-primary">Adicionar pessoa</span>
            <span className="text-[11px] text-muted">{hint}</span>
          </span>
        </button>
      )}
    </fieldset>
  );
}
