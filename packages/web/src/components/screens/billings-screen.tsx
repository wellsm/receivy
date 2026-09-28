"use client";

import {
  activeBillingFilterCount,
  type AuthUser,
  type BillingListFilters,
  BillingState,
  billingShareAction,
  BILLING_TYPE_FILTERS,
  calendarDate,
  DEFAULT_BILLING_LIST_FILTERS,
  filterBillings,
  type BillingSummary,
  type BillingsPage,
  type PlanSummary,
  type PublicLink,
} from "@receivy/common";
import { ChevronLeft, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { loadPlanSummary } from "@/lib/plan-summary";
import { publicLinkUrl } from "@/lib/public-link-url";
import { BillingFiltersSheet } from "@/components/app/billing-filters-sheet";
import { SearchFooter } from "@/components/app/search-footer";
import { BILLING_ROW_COLUMNS, BillingCard } from "@/components/ui/billing-card";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

const LIST_ERROR = "Não foi possível carregar suas cobranças.";

/** Client-side state filter over the loaded pages; ended billings stay out of the way by default. */
const STATE_FILTERS: { value: BillingState; label: string; empty: string }[] = [
  { value: BillingState.Active, label: "Ativas", empty: "Nenhuma conta ativa." },
  { value: BillingState.Paused, label: "Pausadas", empty: "Nenhuma conta pausada." },
  { value: BillingState.Ended, label: "Encerradas", empty: "Nenhuma conta encerrada." },
];

function pillClass(selected: boolean): string {
  return `h-[34px] rounded-full border px-3.5 text-[12.5px] transition ${selected ? "border-ink bg-ink font-bold text-surface" : "border-outline bg-surface font-semibold text-muted hover:text-ink"}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, LIST_ERROR));
  }

  return response.json() as Promise<T>;
}

/** Only the search goes to the API: state, side, frequency and category split the loaded pages here. */
function listQuery(search: string, cursor?: string): string {
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }

  if (cursor) {
    query.set("cursor", cursor);
  }

  const encoded = query.toString();

  return `/api/financial/billings${encoded ? `?${encoded}` : ""}`;
}

type BillingsScreenProps = {
  /** Who is signed in, for the avatar of the narrow header. */
  user?: Pick<AuthUser, "name" | "avatar"> | null;
};

export function BillingsScreen({ user }: BillingsScreenProps = {}) {
  const router = useRouter();
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<BillingState>(BillingState.Active);
  const [filters, setFilters] = useState<BillingListFilters>(DEFAULT_BILLING_LIST_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const requests = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    (cursor?: string) => {
      const generation = cursor ? requests.current : ++requests.current;

      return request<BillingsPage>(listQuery(search, cursor))
        .then((next) => {
          if (generation !== requests.current) {
            return;
          }

          setError("");
          setPage((previous) => (cursor && previous ? { ...next, billings: [...previous.billings, ...next.billings] } : next));
        })
        .catch((reason: unknown) => {
          if (generation === requests.current) {
            setError(reason instanceof Error ? reason.message : LIST_ERROR);
          }
        });
    },
    [search],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 300);

    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPlanSummary().then(setPlan);
  }, []);

  async function copy(value: string) {
    setNotice("");

    try {
      await navigator.clipboard?.writeText(value);

      setNotice("Link copiado");
    } catch {
      setError("Não foi possível copiar o link.");
    }
  }

  async function share(billing: BillingSummary) {
    setError("");
    setNotice("");

    const chargeId = billing.shareChargeId;

    // A conta a pagar has no public link: its action only opens the billing.
    if (billing.type === "payable" || billingShareAction(billing) !== "share" || !chargeId) {
      router.push(`/billings/${billing.id}`);

      return;
    }

    const response = await browserFetch(`/api/financial/charges/${chargeId}/public-link`, { method: "POST" });

    if (!response.ok) {
      router.push(`/charges/${chargeId}`);

      return;
    }

    const link = (await response.json()) as PublicLink;

    await copy(publicLinkUrl(window.location.origin, link));
  }

  const visible = page ? filterBillings(page.billings, stateFilter, filters) : [];
  const filter = STATE_FILTERS.find((option) => option.value === stateFilter) ?? STATE_FILTERS[0]!;
  const counts = page?.counts;

  return (
    <section className="flex min-h-full flex-col gap-3.5 pb-24 md:gap-[18px] md:pb-0">
      {/* Design 8b, below `md`: back to the Feed, the counts, and the avatar that opens Perfil. */}
      <header className="flex items-center gap-3 md:hidden">
        <Link href="/feed" aria-label="Voltar para o Feed" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink">
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>

        <div className="min-w-0 flex-1">
          {counts && (
            <p className="m-0 truncate text-xs text-muted">
              {counts.active} {counts.active === 1 ? "ativa" : "ativas"} · {counts.monthCharges} {counts.monthCharges === 1 ? "cobrança" : "cobranças"} no mês
            </p>
          )}
          <h1 className="m-0 font-display text-[22px] font-bold text-ink">Contas</h1>
        </div>

        <Link href="/settings" aria-label="Perfil" className="shrink-0 rounded-full">
          <InitialsAvatar name={user?.name?.trim() || "R"} size={40} avatar={user?.avatar} />
        </Link>
      </header>

      <div role="tablist" aria-label="Estado" className="-mx-5 flex border-b border-outline md:hidden">
        {STATE_FILTERS.map((option) => {
          const selected = option.value === stateFilter;
          const count = counts?.[option.value];

          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={count === undefined ? option.label : `${option.label} (${count})`}
              onClick={() => setStateFilter(option.value)}
              className={`flex flex-1 flex-col items-center border-b-[2.5px] py-[7px] ${selected ? "border-primary" : "border-transparent"}`}
            >
              <span className={selected ? "text-[13.5px] font-extrabold text-ink" : "text-xs font-bold text-muted"}>{option.label}</span>
              {count !== undefined && <span className={`text-[11px] font-semibold ${selected ? "text-primary" : "text-muted"}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex gap-3">
          <label className="hidden min-h-[42px] min-w-0 flex-1 items-center md:flex gap-[9px] rounded-xl border border-outline bg-surface px-[13px] focus-within:border-primary md:max-w-[280px]">
            <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
              type="search"
              aria-label="Buscar por título ou descrição"
              placeholder="Buscar por título ou descrição…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          {plan && plan.usage.indefinite.used >= Math.ceil(plan.usage.indefinite.limit * 0.8) && (
            <Link href="/settings/plan" className="self-center shrink-0 whitespace-nowrap rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
              {`${plan.usage.indefinite.used} de ${plan.usage.indefinite.limit} cobranças indefinidas`}
            </Link>
          )}
          <Link
            className="hidden h-[42px] shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-[13.5px] font-bold text-on-primary md:ml-auto md:inline-flex"
            href="/billings/new"
            aria-label="Nova conta"
          >
            <Plus size={17} aria-hidden="true" className="text-on-primary" />
            Nova conta
          </Link>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <div role="radiogroup" aria-label="Estado" className="flex gap-2">
            {STATE_FILTERS.map((option) => {
              const selected = option.value === stateFilter;

              return (
                <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => setStateFilter(option.value)} className={pillClass(selected)}>
                  {option.label}
                </button>
              );
            })}
          </div>
          <span aria-hidden="true" className="mx-1.5 hidden h-6 w-px bg-outline md:block" />
          <div role="radiogroup" aria-label="Direção" className="flex gap-2">
            {BILLING_TYPE_FILTERS.map((option) => {
              const selected = option.value === filters.type;

              return (
                <button
                  key={option.value || "all"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setFilters({ ...filters, type: option.value })}
                  className={pillClass(selected)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {notice && (
        <p className="m-0 rounded-xl bg-primary-soft p-3 text-sm text-primary-strong" role="status">
          {notice}
        </p>
      )}

      {!page && !error && (
        <p className="m-0 py-6 text-center text-sm text-muted" role="status">
          Carregando cobranças…
        </p>
      )}

      {error && (
        <div className="flex flex-col gap-2 rounded-xl bg-danger-soft p-4">
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
          <button type="button" className="self-start text-sm font-bold text-danger" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}

      {page && !page.billings.length && (
        <section className="flex flex-col gap-3 rounded-[20px] border border-outline bg-surface p-5">
          <h2 className="m-0 font-display text-2xl font-bold text-ink">Nenhuma conta ainda</h2>
          <p className="m-0 text-sm leading-6 text-muted">Crie a primeira para acompanhar os vencimentos.</p>
          <Link className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 font-bold text-on-primary" href="/billings/new">
            Nova conta
          </Link>
        </section>
      )}

      {page && page.billings.length > 0 && !visible.length && <p className="m-0 py-6 text-center text-sm text-muted">{filter.empty}</p>}

      {visible.length > 0 && (
        <div className="grid gap-3 md:gap-0 md:overflow-hidden md:rounded-[20px] md:border md:border-outline md:bg-surface">
          <div aria-hidden="true" className={`hidden gap-5 border-b border-outline/60 bg-surface-muted/60 px-[22px] py-3 text-[10.5px] font-semibold tracking-[0.1em] text-muted md:grid ${BILLING_ROW_COLUMNS}`}>
            <span>CONTA</span>
            <span>DETALHES</span>
            <span>PRÓX. VENC.</span>
            <span className="text-right">VALOR</span>
            <span />
          </div>
          {visible.map((billing) => (
            <BillingCard
              key={billing.id}
              billing={billing}
              today={today}
              onShare={(target) => void share(target)}
              onOpen={(target) => router.push(`/billings/${target.id}`)}
            />
          ))}
        </div>
      )}

      {page?.nextCursor && (
        <button type="button" className="min-h-12 rounded-xl border border-outline font-bold text-primary" onClick={() => void load(page.nextCursor ?? undefined)}>
          Carregar mais
        </button>
      )}

      {/* Narrow viewports search, filter and create from the footer; wide ones keep the bar above the list. */}
      <SearchFooter placeholder="Buscar conta" value={term} onChange={setTerm} filterCount={activeBillingFilterCount(filters)} onFilter={() => setFiltersOpen(true)} />

      {filtersOpen && (
        <BillingFiltersSheet
          value={filters}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFiltersOpen(false);
            setFilters(next);
          }}
        />
      )}
    </section>
  );
}
