"use client";

import {
  billingShareAction,
  calendarDate,
  formatMoney,
  shortDayMonth,
  type BillingDetail,
  type BillingInvite,
  type BillingSummary,
  type BillingsPage,
} from "@receivy/common";
import { Link2, Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { BillingCard } from "./billing-card";
import { activeBillingChips, BillingFilters, DEFAULT_BILLING_FILTERS, type BillingFiltersValue } from "./billing-filters";
import { BillingForm } from "./billing-form";

const stateLabel = { active: "Ativa", paused: "Pausada", ended: "Encerrada" } as const;
const typeLabel = { once: "Uma vez", until: "Até uma data", indefinite: "Sem fim" } as const;

const LIST_ERROR = "Não foi possível carregar suas cobranças.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, LIST_ERROR));
  }

  return response.json() as Promise<T>;
}

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function listQuery(filters: BillingFiltersValue, search: string, cursor?: string): string {
  const query = new URLSearchParams({ state: filters.state });

  if (filters.type) {
    query.set("type", filters.type);
  }

  if (filters.category) {
    query.set("category", filters.category);
  }

  if (search) {
    query.set("search", search);
  }

  if (cursor) {
    query.set("cursor", cursor);
  }

  return `/api/financial/billings?${query}`;
}

export function BillingsScreen() {
  const router = useRouter();
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [filters, setFilters] = useState<BillingFiltersValue>(DEFAULT_BILLING_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BillingDetail | null>(null);
  const [invite, setInvite] = useState<BillingInvite | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef(0);
  const today = calendarDate();

  const load = useCallback(
    (cursor?: string) => {
      const generation = cursor ? requests.current : ++requests.current;

      return request<BillingsPage>(listQuery(filters, search, cursor))
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
    [filters, search],
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

  async function open(billingId: string) {
    setError("");
    setNotice("");

    try {
      const detail = await request<BillingDetail>(`/api/financial/billings/${billingId}`);
      setSelected(detail);
      setInvite(detail.invite);
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : LIST_ERROR);
    }
  }

  async function share(billing: BillingSummary) {
    setError("");
    setNotice("");

    const chargeId = billing.shareChargeId;

    if (billingShareAction(billing) !== "share" || !chargeId) {
      await open(billing.id);
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

  async function edit(billing: BillingSummary) {
    await open(billing.id);
    setEditing(true);
  }

  async function createInvite() {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const created = await request<BillingInvite>(`/api/financial/billings/${selected.id}/invite`, { method: "POST" });
      setInvite(created);
      await copy(created.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite() {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await browserFetch(`/api/financial/billings/${selected.id}/invite`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível revogar o convite."));
      }

      setInvite(null);
      setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível revogar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(state: "active" | "paused" | "ended") {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const saved = await request<BillingDetail>(`/api/financial/billings/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });

      setSelected(saved);
      setConfirm(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a cobrança.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <BillingForm
        billing={selected}
        onSaved={(saved) => {
          setSelected(saved);
          setEditing(false);
          void load();
        }}
        onBack={() => setEditing(false)}
      />
    );
  }

  if (selected) {
    const canPause = selected.type === "indefinite" && selected.state !== "ended";

    return (
      <section className="financial-page">
        <button
          className="secondary-button"
          onClick={() => {
            setSelected(null);
            setConfirm(false);
            setNotice("");
          }}
        >
          Todas as cobranças
        </button>

        <h1>{selected.description}</h1>
        <p className="billing-detail-meta">
          <span>{typeLabel[selected.type]}</span>
          <span aria-hidden="true"> · </span>
          <span>{stateLabel[selected.state]}</span>
          {selected.frequency && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{selected.frequency === "monthly" ? "Mensal" : "Anual"}</span>
            </>
          )}
        </p>
        <strong className="review-total">{formatMoney(selected.total)} por cobrança</strong>

        {selected.state !== "ended" && (
          <div className="filter-strip">
            <button disabled={busy} onClick={() => setEditing(true)}>
              Editar
            </button>
            {selected.state === "active" && (
              <button disabled={busy} onClick={() => void createInvite()}>
                Convidar
              </button>
            )}
            {canPause && (
              <button disabled={busy} onClick={() => void transition(selected.state === "active" ? "paused" : "active")}>
                {selected.state === "active" ? "Pausar" : "Reativar"}
              </button>
            )}
            <button disabled={busy} onClick={() => setConfirm(true)}>
              Encerrar
            </button>
          </div>
        )}

        {notice && (
          <p className="billings-notice" role="status">
            {notice}
          </p>
        )}

        {invite && (
          <p className="billing-invite-line">
            <Link2 size={14} aria-hidden="true" />
            Convite ativo até {shortDayMonth(invite.expiresAt)}
            <button className="feed-action" disabled={busy} onClick={() => void copy(invite.url)}>
              Copiar
            </button>
            <button className="feed-action" disabled={busy} onClick={() => void revokeInvite()}>
              Revogar
            </button>
          </p>
        )}

        {confirm && (
          <section role="alertdialog" aria-label="Encerrar cobrança">
            <p>Encerrar cancela as cobranças pendentes e impede novas ocorrências. Esta ação não pode ser desfeita.</p>
            <button className="primary-button" disabled={busy} onClick={() => void transition("ended")}>
              Confirmar encerramento
            </button>
            <button className="secondary-button" onClick={() => setConfirm(false)}>
              Voltar
            </button>
          </section>
        )}

        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}

        <h2>Cobranças geradas</h2>
        {!selected.charges.length && <p>Nenhuma cobrança gerada ainda.</p>}
        <div className="timeline-list">
          {selected.charges.map((charge) => (
            <article className="timeline-entry" key={charge.id}>
              <div className="timeline-dot" />
              <div className="timeline-entry-main">
                <h3>{charge.recipient.name}</h3>
                <p>
                  {dateText(charge.dueDate)}
                  {charge.installmentCount && charge.installmentCount > 1 ? ` · ${charge.installment}/${charge.installmentCount}` : ""}
                </p>
              </div>
              <strong className="money">{formatMoney(charge.amount)}</strong>
              <span className={`state-label ${charge.state}`}>
                {charge.state === "pending" ? "Pendente" : charge.state === "paid" ? "Pago" : "Cancelado"}
              </span>
              <Link className="entry-link" href={`/charges/${charge.id}`} aria-label={`Abrir cobrança de ${charge.recipient.name}`}>
                Abrir
              </Link>
            </article>
          ))}
        </div>

        {selected.type === "indefinite" && (
          <>
            <h2>Próximas ocorrências</h2>
            <p>Ainda não são cobranças: projeções não entram no saldo nem permitem pagamento, comprovante ou link.</p>
            {!selected.previews.length && <p>Nenhuma ocorrência futura nesta janela.</p>}
            <ul>
              {selected.previews.map((preview) => (
                <li key={preview.occurrenceDate}>
                  {dateText(preview.occurrenceDate)} · {formatMoney(preview.amount)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    );
  }

  const chips = activeBillingChips(filters);

  return (
    <section className="financial-page billings-page">
      <header className="billings-header">
        <div>
          <h1>Minhas Cobranças</h1>
          <p>Cobranças cadastradas e links</p>
        </div>
        <div className="billings-header-actions">
          <button
            type="button"
            className="billings-icon-button"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen((open) => !open);
              setTerm("");
            }}
          >
            <Search size={16} aria-hidden="true" />
            Buscar
          </button>
          <button
            type="button"
            className="billings-icon-button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Filtros
          </button>
          <Link className="primary-button billings-new" href="/charges/new">
            <Plus size={16} aria-hidden="true" />
            Nova cobrança
          </Link>
        </div>
      </header>

      {searchOpen && (
        <input
          className="billings-search"
          type="search"
          aria-label="Buscar por título ou descrição"
          placeholder="Buscar por título ou descrição…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      )}

      {chips.length > 0 && (
        <div className="billings-chip-row">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="billings-chip is-active"
              aria-label={`Remover filtro ${chip.label}`}
              onClick={() => setFilters({ ...filters, [chip.key]: DEFAULT_BILLING_FILTERS[chip.key] })}
            >
              {chip.label} ×
            </button>
          ))}
        </div>
      )}

      {filtersOpen && <BillingFilters value={filters} onChange={setFilters} />}

      {notice && (
        <p className="billings-notice" role="status">
          {notice}
        </p>
      )}

      {!page && !error && <p role="status">Carregando cobranças…</p>}

      {error && (
        <p role="alert" className="login-error">
          {error}{" "}
          <button onClick={() => void load()}>Tentar novamente</button>
        </p>
      )}

      {page && !page.billings.length && (
        <section className="billings-empty">
          <h2>Nenhuma cobrança ainda</h2>
          <p>Crie a primeira para acompanhar os vencimentos.</p>
          <Link className="primary-button" href="/charges/new">
            Nova cobrança
          </Link>
        </section>
      )}

      <div className="billings-list">
        {page?.billings.map((billing) => (
          <BillingCard
            key={billing.id}
            billing={billing}
            today={today}
            onShare={(target) => void share(target)}
            onEdit={(target) => void edit(target)}
            onOpen={(target) => void open(target.id)}
          />
        ))}
      </div>

      {page?.nextCursor && (
        <button className="secondary-button" onClick={() => void load(page.nextCursor ?? undefined)}>
          Carregar mais
        </button>
      )}

      <Link className="fab" href="/charges/new" aria-label="Nova cobrança">
        <Plus size={22} aria-hidden="true" />
      </Link>
    </section>
  );
}
