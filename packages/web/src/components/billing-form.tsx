"use client";

import {
  addCalendarDays,
  BILLING_CATEGORIES,
  billingSummaryLine,
  buildBillingInput,
  calendarDate,
  draftTotalCents,
  EMPTY_BILLING_DRAFT,
  formatMoney,
  parseBRLCents,
  previewBillingSplit,
  splitPartyKey,
  splitParties,
  type BillingDetail,
  type BillingDraft,
  type BillingFrequency,
  type BillingInput,
  type BillingType,
  type PaymentMethod,
  type Person,
  type SplitMode,
  type SplitParty,
} from "@receivy/common";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft, type StoredDraft } from "@/lib/billing-draft";
import { responseMessage } from "@/lib/financial-response";
import { ContactCarousel } from "./contact-carousel";
import { ContactPicker } from "./contact-picker";
import { SplitEditor, type SplitRow } from "./split-editor";

type Attempt = { input: BillingInput; key: string; uncertain: boolean };

type BillingFormProps = {
  billing: BillingDetail | null;
  onSaved: (billing: BillingDetail) => void;
  onBack: () => void;
};

const RETURN_TO = "/charges/new";
const FROZEN_NOTE = "Cobranças já geradas só permitem categoria, Pix e lembretes.";

const TYPES: { value: BillingType; label: string }[] = [
  { value: "once", label: "À vista" },
  { value: "until", label: "Parcelado" },
  { value: "indefinite", label: "Sem fim" },
];

const AMOUNT_LABELS: Record<BillingType, string> = {
  once: "Valor",
  until: "Valor por parcela",
  indefinite: "Valor por ocorrência",
};

const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: "equal", label: "Igual" },
  { value: "shares", label: "Cotas" },
  { value: "fixed", label: "Valor fixo" },
  { value: "percentage", label: "Porcentagem" },
];

const QUICK_DUE: { label: string; days: number }[] = [
  { label: "Hoje", days: 0 },
  { label: "Amanhã", days: 1 },
  { label: "Em 7 dias", days: 7 },
];

const QUICK_AMOUNTS: { cents: number; label: string }[] = [
  { cents: 1_000, label: "+ R$ 10" },
  { cents: 5_000, label: "+ R$ 50" },
  { cents: 10_000, label: "+ R$ 100" },
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

function money(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" });
}

function todayIn(timezone: string): string {
  try {
    return calendarDate(new Date(), timezone);
  } catch {
    return calendarDate();
  }
}

function daysUntil(date: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return null;
  }

  const [year, month, day] = date.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);

  return Math.round((Date.UTC(year!, month! - 1, day!) - Date.UTC(todayYear!, todayMonth! - 1, todayDay!)) / 86_400_000);
}

function dueText(start: string, today: string): string {
  const diff = daysUntil(start, today);

  if (diff === null) {
    return "Sem data";
  }

  if (diff === 0) {
    return "Hoje";
  }

  if (diff === 1) {
    return "Amanhã";
  }

  if (diff > 1 && diff <= 60) {
    return `em ${diff} dias`;
  }

  return `${start.slice(8, 10)}/${start.slice(5, 7)}`;
}

function draftFromBilling(billing: BillingDetail): BillingDraft {
  const parts = billing.split.parts;

  return {
    type: billing.type,
    selected: parts.flatMap(part => (part.kind === "person" ? [part.personId] : [])),
    owner: parts.some(part => part.kind === "owner") || billing.split.mode === "fixed",
    amount: moneyText(billing.total.amountCents),
    description: billing.description,
    frequency: billing.frequency ?? "monthly",
    start: billing.startDate,
    end: billing.endDate ?? "",
    occurrences: "",
    timezone: billing.timezone,
    pix: billing.paymentMethodId ?? "",
    mode: billing.split.mode,
    values: Object.fromEntries(
      parts.map(part => [
        part.kind === "owner" ? "owner" : part.personId,
        "amountCents" in part
          ? moneyText(part.amountCents)
          : "basisPoints" in part
            ? String(part.basisPoints / 100).replace(".", ",")
            : "shares" in part
              ? String(part.shares)
              : "",
      ]),
    ),
    category: billing.category,
    reminders: billing.reminders.map(reminder => ({ ...reminder, offsetDays: String(reminder.offsetDays) })),
  };
}

function unknownPerson(id: string): Person {
  return { id, name: "Contato", email: null, phone: null, archivedAt: null, createdAt: "", hasAccount: false, lastBilledAt: null };
}

function abbreviate(pixKey: string): string {
  return pixKey.length <= 18 ? pixKey : `${pixKey.slice(0, 7)}…${pixKey.slice(-7)}`;
}

export function BillingForm({ billing, onSaved, onBack }: BillingFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<BillingDraft>(() =>
    billing ? draftFromBilling(billing) : EMPTY_BILLING_DRAFT("America/Sao_Paulo", calendarDate()),
  );
  const [recent, setRecent] = useState<Person[]>([]);
  const [directory, setDirectory] = useState<Person[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const restored = useRef<StoredDraft | null>(null);
  const seeAll = useRef<HTMLButtonElement>(null);

  const editing = Boolean(billing);
  const locked = Boolean(attempt);
  const frozen = editing && billing?.type !== "indefinite";
  // `BillingPatch` carries no type, frequency or dates, so the schedule is
  // read-only in every edit — otherwise Salvar would silently drop the change.
  const scheduled = editing;

  useEffect(() => {
    // Reading the side-trip draft empties the storage, and StrictMode runs this
    // effect twice in dev: the ref survives the cleanup, so the second pass gets
    // the same draft back instead of `null`. It is applied only once the remote
    // data lands, so the form never re-renders twice on mount.
    const stored = billing ? null : (takeDraft() ?? restored.current);

    restored.current = stored;

    let live = true;

    void Promise.all([
      request<{ people: Person[]; nextCursor: string | null }>("/api/people?sort=recent"),
      request<{ paymentMethods: PaymentMethod[] }>("/api/financial/payment-methods"),
      billing || stored ? Promise.resolve(null) : request<{ user: { timezone: string } }>("/api/auth/me"),
    ])
      .then(([agenda, wallet, me]) => {
        if (!live) {
          return;
        }

        const active = wallet.paymentMethods.filter(method => !method.archivedAt);

        setRecent(agenda.people.slice(0, 12));
        setDirectory(agenda.people);
        setMethods(active);
        setDraft(current => {
          const base = stored ? stored.draft : current;
          const pix = billing || stored ? base.pix : (active.find(method => method.isDefault)?.id ?? base.pix);

          return { ...base, pix, ...(me ? { timezone: me.user.timezone, start: todayIn(me.user.timezone) } : {}) };
        });
        setReady(true);
      })
      .catch(reason => {
        if (!live) {
          return;
        }

        setDraft(current => (stored ? stored.draft : current));
        setError((reason as Error).message);
      });

    return () => {
      live = false;
    };
  }, [billing]);

  function update(patch: Partial<BillingDraft>) {
    if (locked) {
      return;
    }

    setError("");
    setDraft(current => ({ ...current, ...patch }));
  }

  function toggle(personId: string) {
    update({ selected: draft.selected.includes(personId) ? draft.selected.filter(id => id !== personId) : [...draft.selected, personId] });
  }

  const remember = useCallback((people: Person[]) => {
    setDirectory(current => [...current, ...people.filter(person => !current.some(known => known.id === person.id))]);
  }, []);

  function leaveTo(path: string) {
    saveDraft(draft, RETURN_TO);
    router.push(path);
  }

  function addAmount(cents: number) {
    let current = 0;

    try {
      current = parseBRLCents(draft.amount);
    } catch {
      current = 0;
    }

    update({ amount: moneyText(current + cents) });
  }

  async function save(sent: Attempt) {
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
    } catch (reason) {
      const status = (reason as { status?: number }).status;
      const uncertain = sent.uncertain || !status || status >= 500;

      setAttempt(uncertain ? { ...sent, uncertain: true } : null);
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function patchBody(input: BillingInput) {
    const editable = {
      paymentMethodId: input.paymentMethodId,
      clearPaymentMethod: !input.paymentMethodId,
      reminders: input.reminders,
      category: input.category,
    };

    if (billing && billing.type !== "indefinite") {
      return editable;
    }

    return { description: input.description, totalCents: input.totalCents, split: input.split, ...editable };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (locked && attempt) {
      void save(attempt);
      return;
    }

    try {
      void save({ input: buildBillingInput(draft), key: crypto.randomUUID(), uncertain: false });
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  const today = todayIn(draft.timezone);
  const totalCents = draftTotalCents(draft);
  const { amounts, error: hint } = previewBillingSplit(draft);
  const carousel = [
    ...recent,
    ...draft.selected
      .filter(id => !recent.some(person => person.id === id))
      .map(id => directory.find(person => person.id === id) ?? unknownPerson(id)),
  ];

  function nameOf(key: string): string {
    if (key === "owner") {
      return "Eu";
    }

    return directory.find(person => person.id === key)?.name ?? "Contato";
  }

  const rowParties: SplitParty[] = draft.mode === "fixed" ? draft.selected.map(personId => ({ kind: "person", personId })) : splitParties(draft);
  const rows: SplitRow[] = rowParties.map(party => {
    const key = splitPartyKey(party);
    const cents = amounts[key];
    const amount = cents === undefined ? "" : money(cents);
    const shares = draft.values[key] || "1";

    return {
      key,
      name: nameOf(key),
      value: draft.values[key] ?? "",
      amountText: draft.mode === "shares" && amount ? `${shares} cota${shares === "1" ? "" : "s"} · ${amount}` : amount,
    };
  });

  const people = draft.selected.length + (draft.owner ? 1 : 0);
  const perPerson = draft.mode === "equal" ? (Object.values(amounts)[0] ?? 0) : totalCents;
  const summary =
    people && totalCents
      ? billingSummaryLine({ people, amountCents: perPerson, mode: draft.mode, dueLabel: dueText(draft.start, today) })
      : "Escolha os contatos e informe o valor.";

  return (
    <form className="billing-form" onSubmit={submit}>
      <header className="billing-form-header">
        <button type="button" className="back-link" onClick={onBack}>
          ← Voltar
        </button>
        <p className="date-line">{editing ? "Editar cobrança" : "Nova cobrança"}</p>
      </header>
      {frozen && <p className="billing-frozen-note">{FROZEN_NOTE}</p>}
      {!ready && !error && <p role="status">Carregando dados…</p>}

      <fieldset className="form-step" disabled={locked || frozen}>
        <legend>1. Para quem?</legend>
        <ContactCarousel
          people={carousel}
          selected={draft.selected}
          today={today}
          disabled={locked || frozen}
          allowNew={!editing}
          onToggle={toggle}
          onNew={() => leaveTo(`/people?returnTo=${RETURN_TO}`)}
        />
        <button type="button" className="secondary-button" ref={seeAll} onClick={() => setPicker(true)}>
          Ver todos
        </button>
        {picker && (
          <ContactPicker
            selected={draft.selected}
            returnFocusTo={seeAll}
            onToggle={toggle}
            onSeen={remember}
            onClose={() => setPicker(false)}
          />
        )}
        <label className="owner-toggle">
          <input type="checkbox" checked={draft.owner} onChange={event => update({ owner: event.target.checked })} /> Eu também participo
        </label>
      </fieldset>

      <fieldset className="form-step" disabled={locked || frozen}>
        <legend>2. Qual o valor?</legend>
        <label htmlFor="billing-amount">{AMOUNT_LABELS[draft.type]}</label>
        <div className="amount-hero">
          <span aria-hidden="true">R$</span>
          <input id="billing-amount" inputMode="decimal" placeholder="0,00" value={draft.amount} onChange={event => update({ amount: event.target.value })} />
        </div>
        <div className="chip-row">
          {QUICK_AMOUNTS.map(option => (
            <button key={option.cents} type="button" className="chip" onClick={() => addAmount(option.cents)}>
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="form-step" disabled={locked}>
        <legend>3. Descrição</legend>
        <label htmlFor="billing-description">Descrição</label>
        <input
          id="billing-description"
          maxLength={500}
          disabled={frozen}
          value={draft.description}
          onChange={event => update({ description: event.target.value })}
        />
        <div className="chip-row" role="group" aria-label="Categoria">
          {BILLING_CATEGORIES.map(category => (
            <button
              key={category.value}
              type="button"
              className={draft.category === category.value ? "chip is-active" : "chip"}
              aria-pressed={draft.category === category.value}
              onClick={() => update({ category: category.value, description: draft.description || category.label })}
            >
              {category.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="form-step" disabled={locked || scheduled}>
        <legend>4. Modalidade</legend>
        <div className="segmented" role="radiogroup" aria-label="Modalidade">
          {TYPES.map(option => (
            <label key={option.value} className={draft.type === option.value ? "is-active" : ""}>
              <input
                type="radio"
                name="billing-type"
                value={option.value}
                checked={draft.type === option.value}
                onChange={() => update({ type: option.value, frequency: option.value === "until" ? "monthly" : draft.frequency, end: "" })}
              />
              {option.label}
            </label>
          ))}
        </div>
        {draft.type === "until" && (
          <>
            <label htmlFor="billing-occurrences">Parcelas</label>
            <input
              id="billing-occurrences"
              type="number"
              min={2}
              max={120}
              inputMode="numeric"
              value={draft.occurrences}
              onChange={event => update({ occurrences: event.target.value })}
            />
          </>
        )}
        {draft.type === "indefinite" && (
          <>
            <label htmlFor="billing-frequency">Frequência</label>
            <select id="billing-frequency" value={draft.frequency} onChange={event => update({ frequency: event.target.value as BillingFrequency })}>
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
            </select>
          </>
        )}
      </fieldset>

      <fieldset className="form-step" disabled={locked || frozen}>
        <legend>5. Divisão</legend>
        <div className="segmented" role="radiogroup" aria-label="Divisão">
          {SPLIT_MODES.map(option => (
            <label key={option.value} className={draft.mode === option.value ? "is-active" : ""}>
              <input type="radio" name="billing-split" value={option.value} checked={draft.mode === option.value} onChange={() => update({ mode: option.value })} />
              {option.label}
            </label>
          ))}
        </div>
        <SplitEditor mode={draft.mode} rows={rows} hint={hint ?? ""} disabled={locked || frozen} onChange={(key, value) => update({ values: { ...draft.values, [key]: value } })} />
      </fieldset>

      <fieldset className="form-step" disabled={locked || scheduled}>
        <legend>6. Vencimento</legend>
        <div className="chip-row">
          {QUICK_DUE.map(option => (
            <button
              key={option.label}
              type="button"
              className={draft.start === addCalendarDays(today, option.days) ? "chip is-active" : "chip"}
              aria-pressed={draft.start === addCalendarDays(today, option.days)}
              onClick={() => update({ start: addCalendarDays(today, option.days) })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label htmlFor="billing-start">Vencimento</label>
        <input id="billing-start" type="date" value={draft.start} onChange={event => update({ start: event.target.value })} />
        <p className="form-hint">Lembrete no vencimento.</p>
      </fieldset>

      <fieldset className="form-step" disabled={locked}>
        <legend>7. Pix</legend>
        <div className="chip-row" role="group" aria-label="Chave Pix">
          {methods.map(method => (
            <button
              key={method.id}
              type="button"
              className={draft.pix === method.id ? "chip is-active" : "chip"}
              aria-pressed={draft.pix === method.id}
              onClick={() => update({ pix: method.id })}
            >
              <strong>{method.label || method.pixKey}</strong>
              <small>{abbreviate(method.pixKey)}</small>
            </button>
          ))}
          <button type="button" className={draft.pix ? "chip" : "chip is-active"} aria-pressed={!draft.pix} onClick={() => update({ pix: "" })}>
            Nenhuma
          </button>
          {!editing && (
            <button type="button" className="chip" onClick={() => leaveTo(`/settings/pix?returnTo=${RETURN_TO}`)}>
              Cadastrar chave
            </button>
          )}
        </div>
        {draft.reminders.map((reminder, index) => (
          <div key={index} className="reminder-row">
            <label>
              <input
                type="checkbox"
                checked={reminder.enabled}
                onChange={event => update({ reminders: draft.reminders.map((item, position) => (position === index ? { ...item, enabled: event.target.checked } : item)) })}
              />
              Lembrete {index + 1}
            </label>
            <label>
              Dias em relação ao vencimento
              <input
                inputMode="text"
                value={reminder.offsetDays}
                onChange={event => update({ reminders: draft.reminders.map((item, position) => (position === index ? { ...item, offsetDays: event.target.value } : item)) })}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary-button"
          disabled={draft.reminders.length >= 10}
          onClick={() => update({ reminders: [...draft.reminders, { offsetDays: "", enabled: true }] })}
        >
          Adicionar lembrete
        </button>
      </fieldset>

      <footer className="billing-form-footer">
        <p className="billing-form-summary">{summary}</p>
        {busy && <p role="status">Salvando…</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        {attempt?.uncertain ? (
          <button type="submit" className="primary-button" disabled={busy}>
            Tentar novamente
          </button>
        ) : (
          <button type="submit" className="primary-button" disabled={busy}>
            {editing ? "Salvar" : "Criar cobrança"}
          </button>
        )}
      </footer>
    </form>
  );
}
