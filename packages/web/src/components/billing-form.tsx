"use client";

import {
  buildBillingInput,
  calendarDate,
  DEFAULT_BILLING_REMINDERS,
  formatMoney,
  resolveBillingSplit,
  type BillingDetail,
  type BillingFrequency,
  type BillingInput,
  type BillingType,
  type NotificationPreferences,
  type PaymentMethod,
  type Person,
  type ReminderDraft,
  type SplitMode,
} from "@receivy/common";
import { useEffect, useState } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";

type Attempt = { input: BillingInput; key: string; uncertain: boolean };

type BillingFormProps = {
  billing: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
  onBack: () => void;
};

const TYPES: { value: BillingType; label: string; hint: string }[] = [
  { value: "once", label: "Uma vez", hint: "Uma cobrança por pessoa no vencimento." },
  { value: "until", label: "Até uma data", hint: "Repete até a data final ou N vezes." },
  { value: "indefinite", label: "Sem fim", hint: "Repete até você encerrar." },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await browserFetch(path, init);

  if (!response.ok) {
    const error = new Error(await responseMessage(response, "Não foi possível salvar. Tente novamente."));
    throw Object.assign(error, { status: response.status });
  }

  return response.json() as Promise<T>;
}

function moneyText(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" }).replace(/[^\d,]/g, "");
}

export function BillingForm({ billing, onSaved, onBack }: BillingFormProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [type, setType] = useState<BillingType>(billing?.type ?? "once");
  const [selected, setSelected] = useState<string[]>(billing?.split.parts.flatMap((p) => (p.kind === "person" ? [p.personId] : [])) ?? []);
  const [owner, setOwner] = useState(billing ? billing.split.parts.some((p) => p.kind === "owner") || billing.split.mode === "fixed" : true);
  const [amount, setAmount] = useState(billing ? moneyText(billing.total.amountCents) : "");
  const [description, setDescription] = useState(billing?.description ?? "");
  const [frequency, setFrequency] = useState<BillingFrequency>(billing?.frequency ?? "monthly");
  const [start, setStart] = useState(billing?.startDate ?? calendarDate());
  const [end, setEnd] = useState(billing?.endDate ?? "");
  const [occurrences, setOccurrences] = useState("");
  const [timezone, setTimezone] = useState(billing?.timezone ?? "America/Sao_Paulo");
  const [pix, setPix] = useState(billing?.paymentMethodId ?? "");
  const [mode, setMode] = useState<SplitMode>(billing?.split.mode ?? "equal");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      billing?.split.parts.map((p) => [
        p.kind === "owner" ? "owner" : p.personId,
        "amountCents" in p ? moneyText(p.amountCents) : "basisPoints" in p ? String(p.basisPoints / 100).replace(".", ",") : "",
      ]) ?? [],
    ),
  );
  const [reminders, setReminders] = useState<ReminderDraft[]>(
    (billing?.reminders ?? DEFAULT_BILLING_REMINDERS).map((r) => ({ ...r, offsetDays: String(r.offsetDays) })),
  );
  const [review, setReview] = useState<BillingInput | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const editing = Boolean(billing);
  const locked = Boolean(attempt);
  const frozen = editing && billing?.type !== "indefinite";

  useEffect(() => {
    void Promise.all([
      request<{ people: Person[]; nextCursor: string | null }>("/api/people?archived=false").then((page) => {
        setPeople(page.people);
        setCursor(page.nextCursor);
      }),
      request<{ paymentMethods: PaymentMethod[] }>("/api/financial/payment-methods").then((page) => {
        setMethods(page.paymentMethods);
        if (!billing) setPix(page.paymentMethods.find((m) => m.isDefault)?.id ?? "");
      }),
      billing
        ? Promise.resolve()
        : request<{ user: { timezone: string } }>("/api/auth/me").then(({ user }) => {
            setTimezone(user.timezone);
            setStart(calendarDate(new Date(), user.timezone));
          }),
      billing
        ? Promise.resolve()
        : request<NotificationPreferences>("/api/financial/notification-preferences")
            .then((preferences) => {
              setReminders(preferences.reminderOffsets.map((offsetDays) => ({ offsetDays: String(offsetDays), enabled: true })));
            })
            .catch(() => {
              // Owner preferences are optional context; the initial state already falls back to DEFAULT_BILLING_REMINDERS.
            }),
    ])
      .then(() => setReady(true))
      .catch((e) => setError((e as Error).message));
  }, [billing]);

  async function loadMore() {
    if (!cursor) return;

    try {
      const page = await request<{ people: Person[]; nextCursor: string | null }>(`/api/people?archived=false&cursor=${encodeURIComponent(cursor)}`);
      setPeople((old) => [...old, ...page.people.filter((p) => !old.some((a) => a.id === p.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      if (locked) return;
      setter(value);
      setReview(null);
    };
  }

  function prepare() {
    setError("");

    try {
      setReview(buildBillingInput({ type, selected, owner, amount, description, frequency, start, end, occurrences, timezone, pix, mode, values, reminders }));
    } catch (e) {
      setReview(null);
      setError((e as Error).message);
    }
  }

  function patchBody(input: BillingInput) {
    const editable = { paymentMethodId: input.paymentMethodId, clearPaymentMethod: !input.paymentMethodId, reminders: input.reminders };

    if (billing && billing.type !== "indefinite") {
      return editable;
    }

    return { description: input.description, totalCents: input.totalCents, split: input.split, ...editable };
  }

  async function save(retry = attempt) {
    if (!review && !retry) return;

    const sent = retry ?? { input: review!, key: crypto.randomUUID(), uncertain: false };
    setAttempt(sent);
    setBusy(true);
    setError("");

    try {
      const saved = billing
        ? await request<BillingDetail>(`/api/financial/billings/${billing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patchBody(sent.input)),
          })
        : await request<BillingDetail>("/api/financial/billings", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": sent.key },
            body: JSON.stringify(sent.input),
          });
      setAttempt(null);
      onSaved(saved);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const uncertain = sent.uncertain || !status || status >= 500;
      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectable = [...people, ...selected.filter((id) => !people.some((p) => p.id === id)).map((id, i) => ({ id, name: `Contato indisponível ${i + 1}` }))];
  const allocations = review ? resolveBillingSplit(review.totalCents, review.split) : [];
  const disabled = locked || !ready;
  const nameOf = (id: string) => (id === "owner" ? "Minha parte" : (people.find((p) => p.id === id)?.name ?? "Contato indisponível"));

  return (
    <section className="financial-page">
      <header>
        <p className="date-line">{editing ? "Editar cobrança" : "Nova cobrança"}</p>
        <h1>Divida com clareza antes de cobrar.</h1>
        <p>{editing ? "Edições valem só para ocorrências ainda não geradas." : "Seu rascunho permanece aqui se a rede falhar."}</p>
      </header>
      {!ready && !error && <p role="status">Carregando dados…</p>}
      <div className="creation-layout">
        <form className="creation-form" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
          <fieldset disabled={disabled || editing}>
            <legend>Como cobrar</legend>
            <div className="type-picker" role="radiogroup" aria-label="Tipo de cobrança">
              {TYPES.map((option) => (
                <label key={option.value} className={type === option.value ? "is-active" : ""} aria-label={option.label}>
                  <input type="radio" name="billing-type" value={option.value} checked={type === option.value} onChange={() => change(setType)(option.value)} />
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={disabled || frozen}>
            <legend>Pessoas</legend>
            <div className="person-picker">
              {selectable.map((person) => (
                <label key={person.id}>
                  <input type="checkbox" checked={selected.includes(person.id)} onChange={() => change(setSelected)(selected.includes(person.id) ? selected.filter((id) => id !== person.id) : [...selected, person.id])} />
                  {person.name}
                </label>
              ))}
            </div>
            {cursor && <button type="button" className="secondary-button" onClick={() => void loadMore()}>Carregar mais contatos</button>}
            <label className="owner-toggle">
              <input type="checkbox" checked={owner} onChange={(e) => change(setOwner)(e.target.checked)} /> Incluir minha parte
            </label>
          </fieldset>

          <fieldset disabled={disabled || frozen}>
            <legend>Valor e rateio</legend>
            <label htmlFor="billing-amount">Valor de cada cobrança</label>
            <input id="billing-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => change(setAmount)(e.target.value)} />
            <label htmlFor="billing-description">Descrição</label>
            <input id="billing-description" maxLength={500} value={description} onChange={(e) => change(setDescription)(e.target.value)} placeholder="Opcional" />
            <label htmlFor="billing-mode">Como dividir</label>
            <select id="billing-mode" value={mode} onChange={(e) => change(setMode)(e.target.value as SplitMode)}>
              <option value="equal">Partes iguais</option>
              <option value="fixed">Valores fixos</option>
              <option value="percentage">Percentuais</option>
            </select>
            {mode !== "equal" &&
              [...selected, ...(owner && mode === "percentage" ? ["owner"] : [])].map((id) => (
                <label key={id}>
                  {mode === "fixed" ? "Valor" : "Percentual"} de {nameOf(id)}
                  <input inputMode="decimal" value={values[id] ?? ""} onChange={(e) => change(setValues)({ ...values, [id]: e.target.value })} />
                </label>
              ))}
          </fieldset>

          <fieldset disabled={disabled || editing}>
            <legend>Quando</legend>
            <label htmlFor="billing-start">{type === "once" ? "Vencimento" : "Primeiro vencimento"}</label>
            <input id="billing-start" type="date" value={start} onChange={(e) => change(setStart)(e.target.value)} />
            {type !== "once" && (
              <>
                <label htmlFor="billing-frequency">Frequência</label>
                <select id="billing-frequency" value={frequency} onChange={(e) => change(setFrequency)(e.target.value as BillingFrequency)}>
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                </select>
                <p>Dias inexistentes usam o último dia do mês.</p>
              </>
            )}
            {type === "until" && (
              <>
                <label htmlFor="billing-occurrences">Quantas vezes</label>
                <input id="billing-occurrences" inputMode="numeric" placeholder="ex.: 3" value={occurrences} onChange={(e) => change(setOccurrences)(e.target.value)} />
                <label htmlFor="billing-end">Ou até a data</label>
                <input id="billing-end" type="date" value={end} onChange={(e) => change(setEnd)(e.target.value)} />
              </>
            )}
            <label htmlFor="billing-timezone">Fuso horário IANA</label>
            <input id="billing-timezone" value={timezone} onChange={(e) => change(setTimezone)(e.target.value)} />
          </fieldset>

          <fieldset disabled={disabled}>
            <legend>Pix e lembretes</legend>
            <label htmlFor="billing-pix">Chave Pix nos links</label>
            <select id="billing-pix" value={pix} onChange={(e) => change(setPix)(e.target.value)}>
              <option value="">Usar chave principal, se houver</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.label || m.pixKey}</option>)}
            </select>
            {reminders.map((r, index) => (
              <div key={index} className="reminder-row">
                <label>
                  <input type="checkbox" checked={r.enabled} onChange={(e) => change(setReminders)(reminders.map((a, i) => (i === index ? { ...a, enabled: e.target.checked } : a)))} />
                  Lembrete {index + 1}
                </label>
                <label>
                  Dias em relação ao vencimento
                  <input type="text" inputMode="text" value={r.offsetDays} onChange={(e) => change(setReminders)(reminders.map((a, i) => (i === index ? { ...a, offsetDays: e.target.value } : a)))} />
                </label>
              </div>
            ))}
            <button type="button" className="secondary-button" disabled={reminders.length >= 10} onClick={() => change(setReminders)([...reminders, { offsetDays: "", enabled: true }])}>
              Adicionar lembrete
            </button>
          </fieldset>

          <button className="primary-button" type="submit" disabled={disabled}>Revisar cobrança</button>
          <button className="secondary-button" type="button" disabled={locked} onClick={onBack}>Voltar</button>
        </form>

        <aside className="review-panel" aria-live="polite">
          <h2>Revisão exata</h2>
          {!review && <p>Preencha e revise antes de criar. Nada é salvo nesta etapa.</p>}
          {review && (
            <>
              <p className="review-total">{formatMoney({ amountCents: review.totalCents, currency: "BRL" })} por cobrança</p>
              <ul>
                {allocations.map((a) => (
                  <li key={a.kind === "owner" ? "owner" : a.personId}>
                    <span>{nameOf(a.kind === "owner" ? "owner" : a.personId)}</span>
                    <strong>{formatMoney({ amountCents: a.amountCents, currency: "BRL" })}</strong>
                  </li>
                ))}
              </ul>
              <button className="primary-button" type="button" disabled={busy || locked} onClick={() => void save(null)}>
                {editing ? "Salvar cobrança" : "Criar cobrança"}
              </button>
            </>
          )}
          {busy && <p role="status">Salvando…</p>}
          {error && <p className="login-error" role="alert">{error}</p>}
          {attempt?.uncertain && (
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void save()}>
              {editing ? "Tentar salvar novamente" : "Tentar criar novamente"}
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
