"use client";

import { BILLING_CATEGORIES, billingCategoryColor, billingCategoryLabel, type BillingCategory } from "@receivy/common";
import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CategoryIcon } from "@/components/ui/category-icon";

type CategorySelectProps = {
  value: BillingCategory;
  onSelect: (category: BillingCategory) => void;
  disabled?: boolean;
};

/**
 * One panel, two shapes: a bottom sheet up to `sm`, an anchored dropdown from `sm` on.
 * The split is pure CSS so the markup stays single-sourced and nothing depends on a
 * viewport measured at render time.
 */
export function CategorySelect({ value, onSelect, disabled }: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const color = billingCategoryColor(value);
  // A locked form can disable the control while the panel is open; the panel goes with it.
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
        aria-label="Categoria"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-outline/50 bg-surface px-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}1F` }}>
          <CategoryIcon category={value} size={18} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{billingCategoryLabel(value)}</span>
        <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-muted ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-30 bg-scrim sm:bg-transparent" role="presentation" onClick={close} />

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
            <h2 className="m-0 mb-3 px-1 text-base font-extrabold text-primary-strong sm:hidden">Categoria</h2>

            <ul id={listId} role="listbox" aria-label="Categoria" className="m-0 flex list-none flex-col gap-1 p-0">
              {BILLING_CATEGORIES.map(category => {
                const active = category.value === value;
                const tint = billingCategoryColor(category.value);

                return (
                  <li key={category.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onSelect(category.value);
                        close();
                      }}
                      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ${active ? "bg-surface-muted" : "bg-transparent"}`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${tint}1F` }}>
                        <CategoryIcon category={category.value} size={18} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{category.label}</span>
                      {active && <Check size={18} aria-hidden="true" style={{ color: tint }} />}
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
