"use client";

import { endOfMonthOptions } from "@receivy/common";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";

type MonthSelectProps = {
  /** The last day of the chosen month (`YYYY-MM-DD`). */
  value: string;
  today: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
};

/** Current month plus the next twelve. */
const MONTHS_AHEAD = 13;

/**
 * Month picker for a due date on the last day of the month. Same panel as CategorySelect:
 * a bottom sheet up to `sm`, an anchored dropdown from `sm` on, split in CSS only.
 */
export function MonthSelect({ value, today, onSelect, disabled }: MonthSelectProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const options = endOfMonthOptions(today, MONTHS_AHEAD);
  // A saved month beyond the window still reads right on the trigger.
  const current = options.find(option => option.value === value) ?? endOfMonthOptions(value, 1)[0]!;
  const expanded = open && !disabled;

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Mês do vencimento"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen(currentOpen => !currentOpen)}
        className="flex h-11 w-full items-center gap-2 rounded-xl border border-outline/50 bg-surface px-3.5 text-left disabled:opacity-60"
      >
        <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-primary-strong" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{current.label}</span>
        <span className="shrink-0 text-xs text-muted">{current.dueLabel}</span>
        <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-muted ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40 sm:bg-transparent" role="presentation" onClick={close} />

          <div
            className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-3xl border-t border-outline/30 bg-canvas p-4 pb-8 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-full sm:max-h-80 sm:rounded-2xl sm:border sm:p-2 sm:pb-2 sm:shadow-xl"
            onKeyDown={event => {
              if (event.key !== "Escape") {
                return;
              }

              event.stopPropagation();
              close();
            }}
          >
            <h2 className="m-0 mb-3 px-1 text-base font-extrabold text-primary-strong sm:hidden">Mês do vencimento</h2>

            <ul id={listId} role="listbox" aria-label="Mês do vencimento" className="m-0 flex list-none flex-col gap-1 p-0">
              {options.map(option => {
                const active = option.value === value;

                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onSelect(option.value);
                        close();
                      }}
                      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ${active ? "bg-surface-muted" : "bg-transparent"}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{option.label}</span>
                      <span className="shrink-0 text-xs text-muted">{option.dueLabel}</span>
                      {active && <Check size={18} aria-hidden="true" className="shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
