"use client";

import { BillingState, billingShareAction, calendarDate, Direction, type BillingSummary, type BillingsPage } from "@receivy/common";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { BillingCard } from "@/components/ui/billing-card";

const LIST_ERROR = "Não foi possível carregar suas cobranças.";

/** Client-side state filter over the loaded pages; ended billings stay out of the way by default. */
const STATE_FILTERS: { value: BillingState; label: string; empty: string }[] = [
  { value: BillingState.Active, label: "Ativas", empty: "Nenhuma conta ativa." },
  { value: BillingState.Paused, label: "Pausadas", empty: "Nenhuma conta pausada." },
  { value: BillingState.Ended, label: "Encerradas", empty: "Nenhuma conta encerrada." },
];

/** Server-side direction filter: the API only returns the side asked for. */
const DIRECTION_FILTERS: { value: Direction | ""; label: string }[] = [
  { value: "", label: "Todas" },
  { value: Direction.Receivable, label: "A receber" },
  { value: Direction.Payable, label: "A pagar" },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, LIST_ERROR));
  }

  return response.json() as Promise<T>;
}

/** No state filter on the request: active, paused and ended billings all come back and the chips split them here. */
function listQuery(search: string, direction: Direction | "", cursor?: string): string {
  const query = new URLSearchParams();

  if (search) {
    query.set("search", search);
  }

  if (direction) {
    query.set("direction", direction);
  }

  if (cursor) {
    query.set("cursor", cursor);
  }

  const encoded = query.toString();

  return `/api/financial/billings${encoded ? `?${encoded}` : ""}`;
}

export function BillingsScreen() {
  const router = useRouter();
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<BillingState>(BillingState.Active);
  const [direction, setDirection] = useState<Direction | "">("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const requests = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    (cursor?: string) => {
      const generation = cursor ? requests.current : ++requests.current;

      return request<BillingsPage>(listQuery(search, direction, cursor))
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
    [search, direction],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), 300);

    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (billing.direction === "payable" || billingShareAction(billing) !== "share" || !chargeId) {
      router.push(`/billings/${billing.id}`);
      return;
    }

    const response = await browserFetch(`/api/financial/charges/${chargeId}/public-link`, { method: "POST" });

    if (!response.ok) {
      router.push(`/charges/${chargeId}`);
      return;
    }

    const link = (await response.json()) as { token: string };
    await copy(`${window.location.origin}/pay/${link.token}`);
  }

  const visible = page?.billings.filter((billing) => billing.state === stateFilter) ?? [];
  const filter = STATE_FILTERS.find((option) => option.value === stateFilter) ?? STATE_FILTERS[0]!;

  return (
    <section className="flex min-h-full flex-col gap-3 pb-24 md:pb-0">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            className="min-h-12 w-full min-w-0 flex-1 rounded-xl border border-outline bg-surface px-4 text-[14px] text-ink placeholder:text-muted"
            type="search"
            aria-label="Buscar por título ou descrição"
            placeholder="Buscar por título ou descrição…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <Link
            className="hidden min-h-12 shrink-0 items-center gap-2 rounded-xl bg-primary-strong px-4 text-sm font-bold text-on-primary md:inline-flex"
            href="/billings/new"
            aria-label="Nova conta"
          >
            <Plus size={18} aria-hidden="true" className="text-on-primary" />
            Nova conta
          </Link>
        </div>
        <div role="radiogroup" aria-label="Estado" className="flex gap-2">
          {STATE_FILTERS.map((option) => {
            const selected = option.value === stateFilter;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setStateFilter(option.value)}
                className={`min-h-9 rounded-full border px-4 text-xs font-semibold transition ${
                  selected ? "border-primary bg-primary-soft/60 text-primary-strong" : "border-outline/40 bg-surface text-muted hover:border-outline"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div role="radiogroup" aria-label="Direção" className="flex gap-2">
          {DIRECTION_FILTERS.map((option) => {
            const selected = option.value === direction;

            return (
              <button
                key={option.value || "all"}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDirection(option.value)}
                className={`min-h-9 rounded-full border px-4 text-xs font-semibold transition ${
                  selected ? "border-primary bg-primary-soft/60 text-primary-strong" : "border-outline/40 bg-surface text-muted hover:border-outline"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {notice && (
        <p className="m-0 rounded-xl bg-primary-soft/40 p-3 text-sm text-primary-strong" role="status">
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
        <section className="flex flex-col gap-3 rounded-2xl border border-outline/40 bg-surface p-5">
          <h2 className="m-0 text-2xl font-extrabold text-primary-strong">Nenhuma conta ainda</h2>
          <p className="m-0 text-sm leading-6 text-muted">Crie a primeira para acompanhar os vencimentos.</p>
          <Link className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 font-bold text-on-primary" href="/billings/new">
            Nova conta
          </Link>
        </section>
      )}

      {page && page.billings.length > 0 && !visible.length && <p className="m-0 py-6 text-center text-sm text-muted">{filter.empty}</p>}

      <div className="grid gap-3 md:grid-cols-2">
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

      {page?.nextCursor && (
        <button type="button" className="min-h-12 rounded-xl border border-outline font-bold text-primary" onClick={() => void load(page.nextCursor ?? undefined)}>
          Carregar mais
        </button>
      )}

      {/* Narrow viewports keep the CTA pinned above the tab bar; wide ones show it beside the search. */}
      <div className="fixed inset-x-0 bottom-[72px] z-[5] border-t border-outline/20 bg-canvas/95 px-5 pb-2 pt-3 backdrop-blur-md md:hidden">
        <Link
          className="flex h-13 items-center justify-center gap-2 rounded-xl bg-primary-strong text-base font-bold text-on-primary"
          href="/billings/new"
          aria-label="Nova conta"
        >
          <Plus size={20} aria-hidden="true" className="text-on-primary" />
          <span className="text-base font-bold text-on-primary">Cadastrar Nova Conta</span>
        </Link>
      </div>
    </section>
  );
}
