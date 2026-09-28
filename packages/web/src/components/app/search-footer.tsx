"use client";

import { Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

type SearchFooterProps = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** How many filters differ from the default; the filter button shows it as a badge. */
  filterCount: number;
  onFilter: () => void;
};

/** Design 8: the compact footer of Feed and Contas below `md`, a search with the filter inside and the + beside it. */
export function SearchFooter({
  placeholder,
  value,
  onChange,
  filterCount,
  onFilter,
}: SearchFooterProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[15] flex items-center gap-2.5 border-t border-outline/60 bg-surface px-3.5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden">
      <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] bg-surface-muted pr-1 pl-3.5 focus-within:outline-2 focus-within:outline-primary">
        <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <input
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={
            filterCount ? `Filtros, ${filterCount} ativos` : "Filtros"
          }
          onClick={onFilter}
          className={`relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${filterCount ? "bg-primary-soft text-primary-strong" : "bg-surface text-ink"}`}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          {filterCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold text-on-primary"
            >
              {filterCount}
            </span>
          )}
        </button>
      </label>

      <Link
        href="/billings/new"
        aria-label="Nova conta"
        className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-primary text-on-primary"
      >
        <Plus size={20} aria-hidden="true" />
      </Link>
    </div>
  );
}
