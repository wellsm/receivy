"use client";

import { formatMoney, type BillingDetail, type BillingSummary, type BillingsPage } from "@receivy/common";
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { BillingForm } from "./billing-form";

const stateLabel = { active: "Ativa", paused: "Pausada", ended: "Encerrada" } as const;
const typeLabel = { once: "Uma vez", until: "Até uma data", indefinite: "Sem fim" } as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Não foi possível carregar suas cobranças."));
  }

  return response.json() as Promise<T>;
}

function dateText(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function BillingsScreen() {
  const [page, setPage] = useState<BillingsPage | null>(null);
  const [selected, setSelected] = useState<BillingDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function load(cursor?: string) {
    return request<BillingsPage>(`/api/financial/billings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
      .then((next) => {
        setError("");
        setPage((old) => (cursor && old ? { ...next, billings: [...old.billings, ...next.billings] } : next));
      })
      .catch((e) => {
        setError((e as Error).message);
      });
  }

  useEffect(() => {
    void load();
  }, []);

  async function open(summary: BillingSummary) {
    setError("");

    try {
      setSelected(await request<BillingDetail>(`/api/financial/billings/${summary.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function transition(state: "active" | "paused" | "ended") {
    if (!selected) return;

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
    } catch (e) {
      setError((e as Error).message);
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
        <button className="secondary-button" onClick={() => { setSelected(null); setConfirm(false); }}>Todas as cobranças</button>
        <h1>{selected.description}</h1>
        <p>{typeLabel[selected.type]} · {stateLabel[selected.state]}{selected.frequency ? ` · ${selected.frequency === "monthly" ? "Mensal" : "Anual"}` : ""}</p>
        <strong className="review-total">{formatMoney(selected.total)} por cobrança</strong>
        {selected.state !== "ended" && (
          <div className="filter-strip">
            {selected.type === "indefinite" && <button disabled={busy} onClick={() => setEditing(true)}>Editar</button>}
            {canPause && (
              <button disabled={busy} onClick={() => void transition(selected.state === "active" ? "paused" : "active")}>
                {selected.state === "active" ? "Pausar" : "Reativar"}
              </button>
            )}
            <button disabled={busy} onClick={() => setConfirm(true)}>Encerrar</button>
          </div>
        )}
        {confirm && (
          <section role="alertdialog" aria-label="Encerrar cobrança">
            <p>Encerrar cancela as cobranças pendentes e impede novas ocorrências. Esta ação não pode ser desfeita.</p>
            <button className="primary-button" disabled={busy} onClick={() => void transition("ended")}>Confirmar encerramento</button>
            <button className="secondary-button" onClick={() => setConfirm(false)}>Voltar</button>
          </section>
        )}
        {error && <p role="alert" className="login-error">{error}</p>}
        <h2>Cobranças geradas</h2>
        {!selected.charges.length && <p>Nenhuma cobrança gerada ainda.</p>}
        <div className="timeline-list">
          {selected.charges.map((charge) => (
            <article className="timeline-entry" key={charge.id}>
              <div className="timeline-dot" />
              <div className="timeline-entry-main">
                <h3>{charge.recipient.name}</h3>
                <p>{dateText(charge.dueDate)}{charge.installmentCount && charge.installmentCount > 1 ? ` · ${charge.installment}/${charge.installmentCount}` : ""}</p>
              </div>
              <strong className="money">{formatMoney(charge.amount)}</strong>
              <span className={`state-label ${charge.state}`}>{charge.state === "pending" ? "Pendente" : charge.state === "paid" ? "Pago" : "Cancelado"}</span>
              <Link className="entry-link" href={`/charges/${charge.id}`} aria-label={`Abrir cobrança de ${charge.recipient.name}`}>Abrir</Link>
            </article>
          ))}
        </div>
        {selected.type === "indefinite" && (
          <>
            <h2>Próximas ocorrências</h2>
            <p>Ainda não são cobranças: projeções não entram no saldo nem permitem pagamento, comprovante ou link.</p>
            {!selected.previews.length && <p>Nenhuma ocorrência futura nesta janela.</p>}
            <ul>
              {selected.previews.map((p) => <li key={p.occurrenceDate}>{dateText(p.occurrenceDate)} · {formatMoney(p.amount)}</li>)}
            </ul>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="financial-page">
      <header className="page-heading">
        <div>
          <h1>Cobranças</h1>
          <p>Uma linha por cobrança configurada. A timeline mostra cada pessoa e vencimento.</p>
        </div>
        <Link className="primary-link" href="/charges/new">Nova cobrança</Link>
      </header>
      {!page && !error && <p role="status">Carregando cobranças…</p>}
      {error && <p role="alert" className="login-error">{error} <button onClick={() => void load()}>Tentar novamente</button></p>}
      {page && !page.billings.length && <p>Nenhuma cobrança ainda. Crie a primeira para acompanhar os vencimentos.</p>}
      <div className="timeline-list">
        {page?.billings.map((billing) => (
          <article className="timeline-entry" key={billing.id}>
            <div className="timeline-dot" />
            <div className="timeline-entry-main">
              <h2>{billing.description}</h2>
              <p>{typeLabel[billing.type]} · {stateLabel[billing.state]}{billing.nextDueDate ? ` · próxima ${dateText(billing.nextDueDate)}` : ""}</p>
            </div>
            <strong className="money">{formatMoney(billing.total)}</strong>
            <button className="secondary-button" aria-label={`Abrir ${billing.description}`} onClick={() => void open(billing)}>Abrir</button>
          </article>
        ))}
      </div>
      {page?.nextCursor && <button className="secondary-button" onClick={() => void load(page.nextCursor ?? undefined)}>Carregar mais</button>}
    </section>
  );
}
