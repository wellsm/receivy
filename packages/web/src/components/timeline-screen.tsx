"use client";

import { calendarDate, formatMoney, type ChargeSummary, type Direction, type TimelineItem, type TimelinePage } from "@receivy/common";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

const filters: { label: string; value: string }[] = [
  { label: "Todos", value: "" }, { label: "A receber", value: "direction=receivable" },
  { label: "A pagar", value: "direction=payable" }, { label: "Hoje", value: "today" },
  { label: "Esta semana", value: "week" }, { label: "Recorrências", value: "source=recurrence" },
  { label: "Pendentes", value: "status=pending" },
];

function dateQuery(value: string): string {
  const today = new Date();
  if (value === "today") return `from=${calendarDate(today)}&to=${calendarDate(today)}`;
  if (value === "week") {
    const end = new Date(today); end.setDate(end.getDate() + 7);
    return `from=${calendarDate(today)}&to=${calendarDate(end)}`;
  }
  return value;
}

function itemDate(item: TimelineItem): string {
  return item.kind === "charge" ? item.charge.dueDate
    : item.kind === "recurrence_preview" ? item.preview.occurrenceDate
    : item.kind === "proof" ? item.proof.createdAt.slice(0, 10) : item.payment.paidAt.slice(0, 10);
}

function ChargeRow({ charge, direction }: { charge: ChargeSummary; direction: Direction }) {
  return <article className="timeline-entry">
    <div className="timeline-dot" aria-hidden="true" />
    <div className="timeline-entry-main">
      <span className={`direction-badge ${direction}`}>{direction === "receivable" ? "A receber" : "A pagar"}</span>
      <h3>{charge.description}</h3>
      <p>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${charge.dueDate}T00:00:00Z`))}
        {charge.installmentCount > 1 ? ` · parcela ${charge.installment}/${charge.installmentCount}` : ""}</p>
    </div>
    <strong className="money">{formatMoney(charge.amount)}</strong>
    <span className={`state-label ${charge.state}`}>{charge.state === "pending" ? "Pendente" : charge.state === "paid" ? "Pago" : "Cancelado"}</span>
    <Link className="entry-link" href={`/charges/${charge.id}`} aria-label={`Abrir cobrança ${charge.description}`}>Abrir</Link>
  </article>;
}

export function TimelineScreen() {
  const [data, setData] = useState<TimelinePage | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async (nextFilter = filter, cursor?: string) => {
    const requestGeneration = cursor ? generation.current : ++generation.current;
    setLoading(true); setError(""); if (!cursor) setData(null);
    const query = new URLSearchParams(dateQuery(nextFilter));
    if (cursor) query.set("cursor", cursor);
    try {
      const response = await browserFetch(`/api/financial/timeline${query.size ? `?${query}` : ""}`);
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar sua timeline."));
      const page = await response.json() as TimelinePage;
      if (requestGeneration !== generation.current) return;
      setData(previous => cursor && previous ? { ...page, items: [...previous.items, ...page.items] } : page);
    } catch (reason) { if (requestGeneration === generation.current) setError(reason instanceof Error ? reason.message : "Não foi possível carregar sua timeline."); }
    finally { if (requestGeneration === generation.current) setLoading(false); }
  }, [filter]);
  useEffect(() => { const requestGeneration = ++generation.current; void browserFetch("/api/financial/timeline").then(async response => {
    if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar sua timeline."));
    return response.json() as Promise<TimelinePage>;
  }).then(page => { if (requestGeneration === generation.current) setData(page); }).catch(reason => { if (requestGeneration === generation.current) setError(reason instanceof Error ? reason.message : "Não foi possível carregar sua timeline."); }).finally(() => { if (requestGeneration === generation.current) setLoading(false); }); }, []);

  const groups = new Map<string, TimelineItem[]>();
  for (const item of data?.items ?? []) groups.set(itemDate(item), [...(groups.get(itemDate(item)) ?? []), item]);
  return <div className="timeline-page">
    <header className="page-heading"><div><p className="date-line">Sua visão de hoje</p><h1>O que entra. O que sai. No mesmo lugar.</h1></div>
      <p className="heading-support">Cada valor mostra claramente se você recebe ou paga.</p></header>
    <section className="balance-ledger" aria-label="Resumo de valores">
      <article className="balance-side receivable"><div><span>A receber</span><strong>{data ? formatMoney(data.summary.receivable) : "—"}</strong></div><small>Valores que outras pessoas devem a você</small></article>
      <div className="ledger-spine" aria-hidden="true"><span /></div>
      <article className="balance-side payable"><div><span>A pagar</span><strong>{data ? formatMoney(data.summary.payable) : "—"}</strong></div><small>Valores vinculados à sua conta</small></article>
    </section>
    {data && <div className="timeline-facts" aria-label="Outros totais"><span><strong>{formatMoney(data.summary.pending)}</strong> pendentes no total</span><span><strong>{formatMoney(data.summary.overdue)}</strong> em atraso</span>{data.summary.proofsToReview > 0 && <span><strong>{data.summary.proofsToReview}</strong> comprovantes para revisar</span>}</div>}
    <div className="filter-strip" role="group" aria-label="Filtrar timeline">{filters.map(option => <button key={option.label} type="button" className={filter === option.value ? "is-active" : ""} onClick={() => { setFilter(option.value); void load(option.value); }}>{option.label}</button>)}</div>
    {error && <p className="login-error" role="alert">{error} <button type="button" onClick={() => void load()}>Tentar novamente</button></p>}
    {loading && <p role="status">Carregando timeline…</p>}
    {!loading && !error && data?.items.length === 0 && <section className="empty-timeline"><div className="timeline-rail"><span /></div><div className="empty-copy"><h2>Sua timeline começa aqui</h2><p>Crie uma cobrança ou entre com o e-mail em que recebeu uma.</p><Link className="primary-link" href="/charges/new">Criar cobrança</Link></div></section>}
    {[...groups].map(([date, items]) => <section className="timeline-day" key={date}><h2>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</h2><div className="timeline-list">{items.map((item, index) => item.kind === "charge" ? <ChargeRow key={item.charge.id} charge={item.charge} direction={item.direction} /> : <article className="timeline-entry" key={`${item.kind}-${index}`}><div className="timeline-dot" /><div><strong>{item.kind === "payment" ? "Pagamento registrado" : item.kind === "proof" ? "Comprovante" : item.preview.description}</strong></div></article>)}</div></section>)}
    {data?.nextCursor && <button className="secondary-button" disabled={loading} onClick={() => void load(filter, data.nextCursor ?? undefined)}>Carregar mais</button>}
  </div>;
}
