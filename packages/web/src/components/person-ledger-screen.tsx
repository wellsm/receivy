"use client";
import { formatMoney, type PersonLedger } from "@receivy/common";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { PersonDetails } from "./person-details";
import { responseMessage } from "@/lib/financial-response";

export function PersonLedgerScreen({ id }: { id: string }) {
  const [ledger, setLedger] = useState<PersonLedger | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async (cursor?: string) => { setLoading(true); setError(""); try { const response = await browserFetch(`/api/financial/people/${id}/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar o histórico deste contato.")); const page = await response.json() as PersonLedger; setLedger(old => cursor && old ? { ...page, charges: [...old.charges, ...page.charges] } : page); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar o histórico deste contato."); } finally { setLoading(false); } }, [id]);
  useEffect(() => { void browserFetch(`/api/financial/people/${id}/ledger`).then(async response => {
    if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar o histórico deste contato.")); return response.json() as Promise<PersonLedger>;
  }).then(setLedger).catch(reason => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o histórico deste contato.")).finally(() => setLoading(false)); }, [id]);
  return <section className="financial-page"><header><p className="date-line">Saldo entre vocês</p><h1>Histórico do contato</h1></header>{ledger && <><PersonDetails person={ledger.person} changed={() => load()} /><div className="detail-ledger three"><div><span>Saldo</span><strong>{formatMoney(ledger.balance)}</strong></div><div><span>A receber</span><strong>{formatMoney(ledger.receivable)}</strong></div><div><span>A pagar</span><strong>{formatMoney(ledger.payable)}</strong></div></div><div className="method-list">{ledger.charges.map(charge => <article key={charge.id}><div><span className={`direction-badge ${charge.direction}`}>{charge.direction === "receivable" ? "A receber" : "A pagar"}</span><strong>{charge.description}</strong><span>{formatMoney(charge.amount)}</span><small>Vence {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${charge.dueDate}T00:00:00Z`))} · parcela {charge.installment}/{charge.installmentCount} · {charge.state === "pending" ? "pendente" : charge.state === "paid" ? "paga" : "cancelada"}</small></div><Link href={`/charges/${charge.id}`}>Abrir cobrança</Link></article>)}</div></>}{loading && <p role="status">Carregando histórico…</p>}{error && <p role="alert" className="login-error">{error}</p>}{ledger?.nextCursor && <button className="secondary-button" onClick={() => void load(ledger.nextCursor ?? undefined)}>Carregar mais</button>}</section>;
}
