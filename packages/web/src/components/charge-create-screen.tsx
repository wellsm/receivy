"use client";

import { calendarDate, formatMoney, parseBRLCents, parsePercentageBasisPoints, resolveExpenseSplit, type ExpenseInput, type PaymentMethod, type PaymentMethodsPage, type PeoplePage, type Person, type SplitMode } from "@receivy/common";
import { useEffect, useMemo, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

function freshKey() { return globalThis.crypto.randomUUID(); }
type SubmittedAttempt = { input: ExpenseInput; idempotencyKey: string; hadUncertainOutcome: boolean };

export function ChargeCreateScreen({ navigate }: { navigate?: (path: string) => void }) {
  const [people, setPeople] = useState<Person[]>([]); const [peopleCursor, setPeopleCursor] = useState<string | null>(null); const [peopleQuery, setPeopleQuery] = useState(""); const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<string[]>([]); const [includeOwner, setIncludeOwner] = useState(true);
  const [amount, setAmount] = useState(""); const [description, setDescription] = useState(""); const [installments, setInstallments] = useState("1");
  const [dueDate, setDueDate] = useState(() => calendarDate()); const [methodId, setMethodId] = useState(""); const [mode, setMode] = useState<SplitMode>("equal");
  const [values, setValues] = useState<Record<string, string>>({}); const [reviewing, setReviewing] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [uncertain, setUncertain] = useState(false); const [submittedAttempt, setSubmittedAttempt] = useState<SubmittedAttempt | null>(null);
  useEffect(() => { void Promise.all([
    browserFetch("/api/people?archived=false").then(async r => { if (!r.ok) throw new Error(await responseMessage(r, "Não foi possível carregar contatos.")); const page = await r.json() as PeoplePage; setPeople(page.people); setPeopleCursor(page.nextCursor); }),
    browserFetch("/api/financial/payment-methods").then(async r => { if (!r.ok) throw new Error(await responseMessage(r, "Não foi possível carregar chaves Pix.")); const list = (await r.json() as PaymentMethodsPage).paymentMethods; setMethods(list); setMethodId(list.find(item => item.isDefault)?.id ?? list[0]?.id ?? ""); }),
  ]).catch(reason => setError(reason.message)); }, []);
  const plan = useMemo(() => {
    try {
      const totalCents = parseBRLCents(amount); const parties = [...selected.map(personId => ({ kind: "person" as const, personId })), ...(includeOwner ? [{ kind: "owner" as const }] : [])];
      const split = mode === "equal" ? { mode, parts: parties } as const : mode === "percentage"
        ? { mode, parts: parties.map(part => ({ ...part, basisPoints: parsePercentageBasisPoints(values[part.kind === "owner" ? "owner" : part.personId] ?? "") })) } as const
        : { mode, parts: selected.map(personId => ({ kind: "person" as const, personId, amountCents: parseBRLCents(values[personId] ?? "0") })) } as const;
      return { totalCents, split, allocations: resolveExpenseSplit(totalCents, Number(installments), split) };
    } catch { return null; }
  }, [amount, includeOwner, installments, mode, selected, values]);
  function startReview() { setError(""); if (!selected.length) return setError("Selecione ao menos um contato."); if (!plan) return setError(mode === "percentage" ? "Confira os percentuais: a soma deve ser 100%." : "Confira o valor e o rateio informados."); setReviewing(true); }
  async function create(retry?: SubmittedAttempt) {
    if (!retry && !plan) return;
    const attempt = retry ?? { input: { description: description.trim() || undefined, totalCents: plan!.totalCents, installmentCount: Number(installments), firstDueDate: dueDate, split: plan!.split, paymentMethodId: methodId || undefined }, idempotencyKey: freshKey(), hadUncertainOutcome: false };
    if (!retry) setSubmittedAttempt(attempt);
    setBusy(true); setError(""); if (!retry) setUncertain(false); let resultUncertain = true;
    try {
      const response = await browserFetch("/api/financial/expenses", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": attempt.idempotencyKey }, body: JSON.stringify(attempt.input) });
      if (!response.ok) { resultUncertain = response.status >= 500; throw new Error(await responseMessage(response, "Não foi possível criar a cobrança.")); }
      const detail = await response.json() as { charges: { id: string }[] }; const id = detail.charges[0]?.id;
      if (!id) throw new Error("A cobrança foi criada, mas o detalhe não foi retornado."); setSubmittedAttempt(null); setUncertain(false); (navigate ?? (path => window.location.assign(path)))(`/charges/${id}`);
    } catch (reason) { const mustPreserveAttempt = attempt.hadUncertainOutcome || resultUncertain; setError(reason instanceof Error ? reason.message : "Não foi possível criar a cobrança."); setUncertain(mustPreserveAttempt); setSubmittedAttempt(mustPreserveAttempt ? { ...attempt, hadUncertainOutcome: true } : null); }
    finally { setBusy(false); }
  }
  async function loadMorePeople() { if (!peopleCursor) return; setError(""); try { const response = await browserFetch(`/api/people?archived=false&cursor=${encodeURIComponent(peopleCursor)}`); if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível carregar contatos.")); const page = await response.json() as PeoplePage; setPeople(current => [...current, ...page.people.filter(person => !current.some(item => item.id === person.id))]); setPeopleCursor(page.nextCursor); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar contatos."); } }
  const visiblePeople = people.filter(person => person.name.toLocaleLowerCase("pt-BR").includes(peopleQuery.toLocaleLowerCase("pt-BR")) || person.email?.toLocaleLowerCase("pt-BR").includes(peopleQuery.toLocaleLowerCase("pt-BR")));
  const locked = Boolean(submittedAttempt);
  return <section className="financial-page"><header><p className="date-line">Nova cobrança</p><h1>Divida com clareza antes de cobrar.</h1><p>Seu rascunho permanece aqui se a rede falhar.</p></header>
    <div className="creation-layout"><form className="creation-form" onSubmit={event => { event.preventDefault(); startReview(); }}>
      <fieldset disabled={locked}><legend>1. Pessoas</legend><label htmlFor="people-search">Buscar contato</label><input id="people-search" value={peopleQuery} onChange={event => setPeopleQuery(event.target.value)} /><div className="person-picker">{visiblePeople.map(person => <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={event => setSelected(old => event.target.checked ? [...old, person.id] : old.filter(id => id !== person.id))} /><span className="person-avatar">{person.name[0]}</span>{person.name}</label>)}</div>{peopleCursor && <button className="secondary-button" type="button" onClick={() => void loadMorePeople()}>Carregar mais contatos</button>}<label className="owner-toggle"><input type="checkbox" checked={includeOwner} onChange={event => setIncludeOwner(event.target.checked)} /> Incluir minha parte</label></fieldset>
      <fieldset disabled={locked}><legend>2. Valor e descrição</legend><label htmlFor="total">Valor total</label><input id="total" inputMode="decimal" placeholder="0,00" value={amount} onChange={event => { setAmount(event.target.value); setReviewing(false); }} /><label htmlFor="description">Descrição</label><input id="description" maxLength={500} value={description} onChange={event => setDescription(event.target.value)} placeholder="Opcional" /></fieldset>
      <fieldset disabled={locked}><legend>3. Parcelas e rateio</legend><label htmlFor="installments">Quantidade de parcelas</label><input id="installments" type="number" min="1" max="360" value={installments} onChange={event => setInstallments(event.target.value)} /><label htmlFor="split-mode">Como dividir</label><select id="split-mode" value={mode} onChange={event => setMode(event.target.value as SplitMode)}><option value="equal">Partes iguais</option><option value="fixed">Valores fixos</option><option value="percentage">Percentuais</option></select>{mode !== "equal" && [...selected.map(id => ({ id, label: people.find(person => person.id === id)?.name ?? id })), ...(mode === "percentage" && includeOwner ? [{ id: "owner", label: "Minha parte" }] : [])].map(part => <label key={part.id}>{part.label}<input aria-label={`${mode === "fixed" ? "Valor" : "Percentual"} de ${part.label}`} inputMode="decimal" value={values[part.id] ?? ""} onChange={event => setValues(old => ({ ...old, [part.id]: event.target.value }))} /></label>)}</fieldset>
      <fieldset disabled={locked}><legend>4. Vencimento e Pix</legend><label htmlFor="due-date">Primeiro vencimento</label><input id="due-date" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /><label htmlFor="pix">Chave Pix nos links</label><select id="pix" value={methodId} onChange={event => setMethodId(event.target.value)}><option value="">Sem chave Pix</option>{methods.map(method => <option value={method.id} key={method.id}>{method.label || method.pixKey}</option>)}</select></fieldset>
      <button className="primary-button" type="submit" disabled={locked}>Revisar cobrança</button></form>
      <aside className="review-panel" aria-live="polite"><h2>Revisão exata</h2>{!reviewing || !plan ? <p>Preencha e revise antes de criar. Nada é salvo nesta etapa.</p> : <><p className="review-total">{formatMoney({ amountCents: plan.totalCents, currency: "BRL" })}</p><ul>{plan.allocations.map(allocation => <li key={allocation.kind === "owner" ? "owner" : allocation.personId}><span>{allocation.kind === "owner" ? "Minha parte" : people.find(person => person.id === allocation.personId)?.name}</span><strong>{formatMoney({ amountCents: allocation.amountCents, currency: "BRL" })}</strong><small>{allocation.installments.length}x — {allocation.installments.map(cents => formatMoney({ amountCents: cents, currency: "BRL" })).join(", ")}</small></li>)}</ul><button className="primary-button" type="button" disabled={busy || locked} onClick={() => void create()}>Criar cobrança</button></>}
      {error && <p role="alert" className="login-error">{error}</p>}{uncertain && submittedAttempt && <button className="secondary-button" type="button" disabled={busy} onClick={() => void create(submittedAttempt)}>Tentar criar novamente</button>}</aside>
    </div>
  </section>;
}
