"use client";

import {
  DEFAULT_FEED_FILTERS,
  FEED_DIRECTIONS,
  FEED_PERIODS,
  FEED_STATUSES,
  FEED_TYPES,
  activeFeedFilterCount,
  feedDirectionLabel,
  feedPeriodLabel,
  feedStatusLabel,
  feedTypeLabel,
  toggleFeedValue,
  type FeedFilters,
  type FeedPeriod,
} from "@receivy/common";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";

type Option<T extends string> = { value: T; label: string };

type FilterDropdownProps<T extends string> = {
  group: string;
  summary: string;
  options: Option<T>[];
  selected: T[];
  /** Counts keyed by option value; only the direction group has them. */
  counts?: Partial<Record<T, number | undefined>>;
  /** Multi groups keep the panel open and treat an empty selection as "all". */
  multiple: boolean;
  onPick: (value: T) => void;
};

/** The desktop shape: a dropdown anchored under its own trigger, one per group. */
function FilterDropdown<T extends string>({ group, summary, options, selected, counts, multiple, onPick }: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const changed = selected.length > 0 && (multiple ? selected.length !== options.length : true);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={group}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(current => !current)}
        className={`flex min-h-10 w-full items-center gap-2 rounded-full border px-4 text-sm ${
          changed ? "border-primary bg-primary-soft/50 text-primary-strong" : "border-outline bg-surface text-ink"
        }`}
      >
        <span aria-hidden="true" className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">
          {group}
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-semibold">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" role="presentation" onClick={close} />

          <div
            className="absolute left-0 top-full z-40 mt-2 max-h-80 w-full min-w-48 overflow-y-auto rounded-2xl border border-outline/30 bg-canvas p-2 shadow-xl"
            onKeyDown={event => {
              if (event.key !== "Escape") {
                return;
              }

              event.stopPropagation();
              close();
            }}
          >
            <ul id={listId} role="listbox" aria-label={group} aria-multiselectable={multiple} className="m-0 flex list-none flex-col gap-1 p-0">
              {options.map(option => {
                const active = selected.includes(option.value);
                const count = counts?.[option.value];

                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onPick(option.value);

                        if (!multiple) {
                          close();
                        }
                      }}
                      className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold ${
                        active ? "bg-surface-muted text-primary-strong" : "bg-transparent text-ink"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {count !== undefined && (
                        <span aria-hidden="true" className="shrink-0 text-xs font-bold text-muted">
                          {count}
                        </span>
                      )}
                      {active && <Check size={16} aria-hidden="true" className="shrink-0 text-primary" />}
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

type ChipGroupProps<T extends string> = {
  group: string;
  options: Option<T>[];
  selected: T[];
  /** Present on multi groups: the chip that clears the selection back to "all". */
  everyLabel?: string;
  onPick: (value: T) => void;
  onClear?: () => void;
};

function ChipGroup<T extends string>({ group, options, selected, everyLabel, onPick, onClear }: ChipGroupProps<T>) {
  const every = !selected.length;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted">{group}</span>

      <div className="flex flex-wrap gap-2">
        {onClear && (
          <button
            type="button"
            aria-label={`${group} ${everyLabel}`}
            aria-pressed={every}
            onClick={onClear}
            className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${
              every ? "border-primary bg-primary text-on-primary" : "border-outline bg-surface text-ink"
            }`}
          >
            {everyLabel}
          </button>
        )}

        {options.map(option => {
          const active = selected.includes(option.value);

          return (
            <button
              key={option.value}
              type="button"
              aria-label={`${group} ${option.label}`}
              aria-pressed={active}
              onClick={() => onPick(option.value)}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${
                active ? "border-primary bg-primary text-on-primary" : "border-outline bg-surface text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type FeedFiltersSheetProps = {
  value: FeedFilters;
  onApply: (filters: FeedFilters) => void;
  onClose: () => void;
};

/** The narrow-screen shape: one bottom sheet holding every group; nothing loads until `Aplicar`. */
function FeedFiltersSheet({ value, onApply, onClose }: FeedFiltersSheetProps) {
  const [draft, setDraft] = useState<FeedFilters>(value);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim"
      role="presentation"
      onClick={onClose}
      onKeyDown={event => {
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
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-xl font-extrabold text-primary-strong">Filtros</h2>
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_FEED_FILTERS)}
            className="min-h-10 bg-transparent px-2 text-sm font-bold text-primary"
          >
            Limpar
          </button>
        </div>

        <ChipGroup
          group="Direção"
          options={FEED_DIRECTIONS}
          selected={draft.direction}
          everyLabel="Todas"
          onClear={() => setDraft({ ...draft, direction: [] })}
          onPick={direction => setDraft({ ...draft, direction: toggleFeedValue(draft.direction, direction) })}
        />
        <ChipGroup
          group="Status"
          options={FEED_STATUSES}
          selected={draft.status}
          everyLabel="Todos"
          onClear={() => setDraft({ ...draft, status: [] })}
          onPick={status => setDraft({ ...draft, status: toggleFeedValue(draft.status, status) })}
        />
        <ChipGroup
          group="Modalidade"
          options={FEED_TYPES}
          selected={draft.type}
          everyLabel="Todas"
          onClear={() => setDraft({ ...draft, type: [] })}
          onPick={type => setDraft({ ...draft, type: toggleFeedValue(draft.type, type) })}
        />
        <ChipGroup group="Período" options={FEED_PERIODS} selected={[draft.period]} onPick={period => setDraft({ ...draft, period })} />

        <button type="button" onClick={() => onApply(draft)} className="min-h-14 rounded-2xl bg-primary font-bold text-on-primary">
          Aplicar
        </button>
      </div>
    </div>
  );
}

type FeedFiltersBarProps = {
  value: FeedFilters;
  onChange: (filters: FeedFilters) => void;
  counts?: { receivable?: number; payable?: number };
};

/**
 * Two shapes, split by CSS: one bottom sheet with every group up to `sm`, and from `sm` on
 * the four groups as dropdowns laid two per row.
 */
export function FeedFiltersBar({ value, onChange, counts }: FeedFiltersBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const changed = activeFeedFilterCount(value);

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-full border px-4 text-sm font-bold sm:hidden ${
          changed ? "border-primary bg-primary-soft/50 text-primary-strong" : "border-outline bg-surface text-ink"
        }`}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        Filtros
        {changed > 0 && (
          <span aria-hidden="true" className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-on-primary">
            {changed}
          </span>
        )}
      </button>

      <div className="hidden gap-2 sm:grid sm:grid-cols-2">
        <FilterDropdown
          group="Direção"
          summary={feedDirectionLabel(value)}
          options={FEED_DIRECTIONS}
          selected={value.direction}
          counts={counts}
          multiple
          onPick={direction => onChange({ ...value, direction: toggleFeedValue(value.direction, direction) })}
        />
        <FilterDropdown
          group="Status"
          summary={feedStatusLabel(value)}
          options={FEED_STATUSES}
          selected={value.status}
          multiple
          onPick={status => onChange({ ...value, status: toggleFeedValue(value.status, status) })}
        />
        <FilterDropdown
          group="Modalidade"
          summary={feedTypeLabel(value)}
          options={FEED_TYPES}
          selected={value.type}
          multiple
          onPick={type => onChange({ ...value, type: toggleFeedValue(value.type, type) })}
        />
        <FilterDropdown
          group="Período"
          summary={feedPeriodLabel(value)}
          options={FEED_PERIODS}
          selected={[value.period]}
          multiple={false}
          onPick={(period: FeedPeriod) => onChange({ ...value, period })}
        />

        {changed > 0 && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FEED_FILTERS)}
            className="col-span-2 min-h-10 justify-self-start rounded-full border border-outline bg-transparent px-4 text-sm font-semibold text-muted"
          >
            Limpar
          </button>
        )}
      </div>

      {sheetOpen && (
        <FeedFiltersSheet
          value={value}
          onClose={() => setSheetOpen(false)}
          onApply={next => {
            setSheetOpen(false);
            onChange(next);
          }}
        />
      )}
    </>
  );
}
