"use client";

import { BILLING_CATEGORIES, BILLING_RECURRENCE_FILTERS, BILLING_TYPE_FILTERS, type BillingCategory, type BillingListFilters, DEFAULT_BILLING_LIST_FILTERS } from "@receivy/common";
import { useState } from "react";

const CATEGORIES: { value: BillingCategory | ""; label: string }[] = [{ value: "", label: "Todas" }, ...BILLING_CATEGORIES];

type ChipGroupProps<T extends string> = {
  group: string;
  options: { value: T; label: string }[];
  selected: T;
  onPick: (value: T) => void;
};

function ChipGroup<T extends string>({ group, options, selected, onPick }: ChipGroupProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-bold tracking-widest text-muted">{group.toUpperCase()}</span>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === selected;

          return (
            <button
              key={option.label}
              type="button"
              aria-label={`${group} ${option.label}`}
              aria-pressed={active}
              onClick={() => onPick(option.value)}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${active ? "border-ink bg-ink text-surface" : "border-outline bg-surface text-muted"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type BillingFiltersSheetProps = {
  value: BillingListFilters;
  onApply: (value: BillingListFilters) => void;
  onClose: () => void;
};

/** Design 8b: the Contas footer filter, with Tipo, Frequência and Categoria; nothing reaches the list until `Aplicar`. */
export function BillingFiltersSheet({ value, onApply, onClose }: BillingFiltersSheetProps) {
  const [draft, setDraft] = useState<BillingListFilters>(value);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          return;
        }

        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col gap-5 overflow-y-auto rounded-t-3xl bg-canvas p-5 pb-8 shadow-2xl"
        role="dialog"
        aria-label="Filtros"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-xl font-extrabold text-primary-strong">Filtros</h2>
          <button type="button" onClick={() => setDraft(DEFAULT_BILLING_LIST_FILTERS)} className="min-h-10 bg-transparent px-2 text-sm font-bold text-primary">
            Limpar
          </button>
        </div>

        <ChipGroup group="Tipo" options={BILLING_TYPE_FILTERS} selected={draft.type} onPick={(type) => setDraft({ ...draft, type })} />
        <ChipGroup group="Frequência" options={BILLING_RECURRENCE_FILTERS} selected={draft.recurrence} onPick={(recurrence) => setDraft({ ...draft, recurrence })} />
        <ChipGroup group="Categoria" options={CATEGORIES} selected={draft.category} onPick={(category) => setDraft({ ...draft, category })} />

        <button type="button" onClick={() => onApply(draft)} className="min-h-14 rounded-2xl bg-primary font-bold text-on-primary">
          Aplicar
        </button>
      </div>
    </div>
  );
}
