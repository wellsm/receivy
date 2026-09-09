"use client";

import { BILLING_CATEGORIES, type BillingCategory, type BillingState, type BillingType } from "@receivy/common";

export type BillingFiltersValue = {
  state: BillingState;
  type: BillingType | "";
  category: BillingCategory | "";
};

export const DEFAULT_BILLING_FILTERS: BillingFiltersValue = { state: "active", type: "", category: "" };

const STATES: { value: BillingState; label: string }[] = [
  { value: "active", label: "Ativas" },
  { value: "paused", label: "Pausadas" },
  { value: "ended", label: "Encerradas" },
];

const TYPES: { value: BillingType | ""; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "once", label: "Única" },
  { value: "until", label: "Parcelada" },
  { value: "indefinite", label: "Sem fim" },
];

const CATEGORIES: { value: BillingCategory | ""; label: string }[] = [
  { value: "", label: "Todas" },
  ...BILLING_CATEGORIES,
];

/** The filters that differ from the default, as removable chips under the search field. */
export function activeBillingChips(value: BillingFiltersValue): { key: keyof BillingFiltersValue; label: string }[] {
  const chips: { key: keyof BillingFiltersValue; label: string }[] = [];

  if (value.state !== DEFAULT_BILLING_FILTERS.state) {
    chips.push({ key: "state", label: STATES.find((option) => option.value === value.state)?.label ?? value.state });
  }

  if (value.type) {
    chips.push({ key: "type", label: TYPES.find((option) => option.value === value.type)?.label ?? value.type });
  }

  if (value.category) {
    chips.push({ key: "category", label: CATEGORIES.find((option) => option.value === value.category)?.label ?? value.category });
  }

  return chips;
}

type ChipGroupProps<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
};

function ChipGroup<T extends string>({ label, options, selected, onSelect }: ChipGroupProps<T>) {
  return (
    <div className="billings-filter-group" role="group" aria-label={label}>
      <p className="billings-filter-label">{label}</p>
      <div className="billings-chip-row">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className={option.value === selected ? "billings-chip is-active" : "billings-chip"}
            aria-pressed={option.value === selected}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type BillingFiltersProps = {
  value: BillingFiltersValue;
  onChange: (value: BillingFiltersValue) => void;
};

export function BillingFilters({ value, onChange }: BillingFiltersProps) {
  return (
    <section className="billings-filters" role="group" aria-label="Filtros">
      <ChipGroup label="Estado" options={STATES} selected={value.state} onSelect={(state) => onChange({ ...value, state })} />
      <ChipGroup label="Tipo" options={TYPES} selected={value.type} onSelect={(type) => onChange({ ...value, type })} />
      <ChipGroup
        label="Categoria"
        options={CATEGORIES}
        selected={value.category}
        onSelect={(category) => onChange({ ...value, category })}
      />
    </section>
  );
}
