"use client";

import {
  addCalendarDays,
  amountDigitsToInput,
  amountInputToDigits,
  billingCategoryLabel,
  BillingDueRule,
  BillingFrequency,
  type BillingDraft,
  BillingRecurrence,
  calendarDate,
  Direction,
  endOfMonth,
  formatAmountDigits,
  formatMoney,
  scheduleHint,
  untilInstallmentPreview,
} from "@receivy/common";
import type { ReactNode } from "react";
import { CategorySelect } from "@/components/app/category-select";
import { MonthSelect } from "@/components/app/month-select";

export const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: Direction.Receivable, label: "Vou receber" },
  { value: Direction.Payable, label: "Vou pagar" },
];

const TYPES: { value: BillingRecurrence; label: string }[] = [
  { value: BillingRecurrence.Once, label: "À vista" },
  { value: BillingRecurrence.Until, label: "Parcelado" },
  { value: BillingRecurrence.Indefinite, label: "Recorrente" },
];

const AMOUNT_LABELS: Record<BillingRecurrence, string> = {
  once: "Valor total",
  until: "Valor total",
  indefinite: "Valor por ocorrência",
};

/** "Já recebi" / "Já paguei", by direction. */
export const SETTLED_LABELS: Record<Direction, string> = { receivable: "Já recebi", payable: "Já paguei" };

export const LABEL_CLASS = "ml-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

const FIELD_BOX = "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-outline bg-surface px-3 py-2";
const FIELD_INPUT = "w-full min-w-0 border-0 bg-transparent p-0 text-[15px] font-semibold text-ink outline-none disabled:opacity-60";
const QUICK = "h-9 shrink-0 rounded-xl border px-3.5 text-xs font-semibold text-primary-strong disabled:opacity-50";

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

export function SectionLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={LABEL_CLASS}>
      {children}
    </label>
  );
}

type SegmentedProps<T extends string> = {
  name: string;
  group: string;
  options: { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
};

/** The pill switch of the design: a muted track, the chosen option raised in white. */
export function Segmented<T extends string>({ name, group, options, value, disabled, onChange }: SegmentedProps<T>) {
  return (
    <div className={`flex rounded-[14px] bg-surface-muted p-1 ${disabled ? "opacity-60" : ""}`} role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const active = option.value === value;

        return (
          <label key={option.value} className={`flex h-10 flex-1 cursor-pointer items-center justify-center rounded-[11px] text-[13px] ${active ? "bg-surface font-bold text-ink shadow-sm" : "font-semibold text-muted"}`}>
            <input type="radio" className="sr-only" name={group} value={option.value} checked={active} disabled={disabled} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

type AmountTitleFieldsProps = {
  draft: BillingDraft;
  /** Every field is read-only while a save is in flight. */
  locked: boolean;
  /** A finite billing already generated its charges: amount and title are read-only. */
  frozen: boolean;
  onChange: (patch: Partial<BillingDraft>) => void;
};

/** The amount, the title and the category: the top of the first column and of the edit screen. */
export function AmountTitleFields({ draft, locked, frozen, onChange }: AmountTitleFieldsProps) {
  const installmentPreview = untilInstallmentPreview(draft);

  // The field behaves like a bank keypad: whatever the browser hands back is
  // reduced to its digits and re-rendered, so typing pushes cents to the left
  // and Backspace drops the last digit.
  function typeAmount(value: string) {
    onChange({ amount: amountDigitsToInput(amountInputToDigits(value)) });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Valor */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" disabled={locked || frozen}>
        <label htmlFor="billing-amount" className={LABEL_CLASS}>
          {AMOUNT_LABELS[draft.type]}
        </label>
        <div className="flex items-baseline gap-1.5 rounded-2xl border border-outline bg-surface px-4 py-2.5">
          <span aria-hidden="true" className="font-display text-base font-medium text-muted">
            R$
          </span>
          <input
            id="billing-amount"
            inputMode="numeric"
            placeholder="0,00"
            value={formatAmountDigits(amountInputToDigits(draft.amount))}
            onChange={(event) => typeAmount(event.target.value)}
            className="w-full min-w-0 border-0 bg-transparent p-0 font-display text-[30px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums outline-none disabled:opacity-60"
          />
        </div>
        {installmentPreview && (
          <p className="m-0 text-[11px] text-muted">
            {installmentPreview.count}x de {money(installmentPreview.perInstallmentCents)}
            {installmentPreview.roundedUp ? ` · total ${money(installmentPreview.totalCents)}` : ""}
          </p>
        )}
      </fieldset>

      {/* Título e categoria */}
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" disabled={locked}>
        <SectionLabel htmlFor="billing-title">Título e categoria</SectionLabel>
        <div className="flex items-center gap-2 rounded-2xl border border-outline bg-surface p-1.5 pl-3.5">
          <input
            id="billing-title"
            aria-label="Título"
            maxLength={500}
            placeholder="Ex: Aluguel do sítio, Pizzaria..."
            disabled={frozen}
            value={draft.description}
            onChange={(event) => onChange({ description: event.target.value })}
            className="h-10 w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-medium text-ink outline-none disabled:opacity-60"
          />
          <div className="w-40 shrink-0">
            <CategorySelect value={draft.category} disabled={locked} onSelect={(category) => onChange({ category, description: draft.description || billingCategoryLabel(category) })} />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

type RepeatFieldsProps = {
  draft: BillingDraft;
  locked: boolean;
  /** No edit changes the type or the frequency: `BillingPatch` carries neither. */
  scheduled: boolean;
  /** Generated occurrences keep their due date; only an assinatura moves its next one. */
  dueLocked: boolean;
  onChange: (patch: Partial<BillingDraft>) => void;
};

/** "Como se repete": the type, the frequency or the instalments, and the due date. */
export function RepeatFields({ draft, locked, scheduled, dueLocked, onChange }: RepeatFieldsProps) {
  const today = todayIn(draft.timezone);
  const settled = draft.settled === true;
  // Month ends exist for a single due date and for monthly rules; a yearly billing keeps a fixed day.
  const monthEnds = draft.type === BillingRecurrence.Once || draft.frequency === BillingFrequency.Monthly;
  const monthEnd = monthEnds && draft.dueRule === BillingDueRule.EndOfMonth;
  // A recorrente registro starts today or later; a single one may be in the past.
  const minimumDate = settled && draft.type !== BillingRecurrence.Once ? today : undefined;
  const dateLabel = scheduled ? "Próximo vencimento" : draft.type === BillingRecurrence.Until ? "Primeira parcela" : draft.type === BillingRecurrence.Indefinite ? "Próximo vencimento" : "Vencimento";
  const hint = scheduleHint(draft);

  function toggleMonthEnd() {
    if (monthEnd) {
      onChange({ dueRule: BillingDueRule.Fixed });

      return;
    }

    onChange({ dueRule: BillingDueRule.EndOfMonth, start: endOfMonth(draft.start && draft.start >= today ? draft.start : today) });
  }

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={locked || scheduled}>
        <span className={LABEL_CLASS}>Como se repete</span>
        <Segmented
          name="Modalidade"
          group="billing-type"
          options={TYPES}
          value={draft.type}
          disabled={locked || scheduled}
          onChange={(type) => onChange({ type, frequency: type === BillingRecurrence.Until ? BillingFrequency.Monthly : draft.frequency, end: "" })}
        />
      </fieldset>

      <div className="flex gap-2">
        {draft.type === BillingRecurrence.Until && (
          <div className={FIELD_BOX}>
            <label htmlFor="billing-occurrences" className="text-[11px] text-muted">
              Parcelas
            </label>
            <input
              id="billing-occurrences"
              type="number"
              min={2}
              max={120}
              inputMode="numeric"
              placeholder="2 a 120"
              disabled={locked || scheduled}
              value={draft.occurrences}
              onChange={(event) => onChange({ occurrences: event.target.value })}
              className={FIELD_INPUT}
            />
          </div>
        )}
        {draft.type === BillingRecurrence.Indefinite && (
          <div className={FIELD_BOX}>
            <label htmlFor="billing-frequency" className="text-[11px] text-muted">
              A cada
            </label>
            <select id="billing-frequency" aria-label="Frequência" disabled={locked || scheduled} value={draft.frequency} onChange={(event) => onChange({ frequency: event.target.value as BillingFrequency })} className={FIELD_INPUT}>
              <option value="monthly">Mês</option>
              <option value="yearly">Ano</option>
            </select>
          </div>
        )}

        <div className={FIELD_BOX}>
          <label htmlFor={monthEnd ? undefined : "billing-start"} className="text-[11px] text-muted">
            {dateLabel}
          </label>
          {monthEnd ? (
            <MonthSelect value={draft.start} today={today} disabled={locked || dueLocked} onSelect={(value) => onChange({ start: value })} />
          ) : (
            <input
              id="billing-start"
              aria-label="Vencimento"
              type="date"
              min={minimumDate}
              disabled={locked || dueLocked}
              value={draft.start}
              onChange={(event) => onChange({ start: event.target.value })}
              className={FIELD_INPUT}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={!monthEnd && draft.start === today}
          disabled={locked || dueLocked}
          onClick={() => onChange({ start: addCalendarDays(today, 0), dueRule: BillingDueRule.Fixed })}
          className={`${QUICK} ${!monthEnd && draft.start === today ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"}`}
        >
          Hoje
        </button>
        {monthEnds && (
          <button type="button" aria-pressed={monthEnd} disabled={locked || dueLocked} onClick={toggleMonthEnd} className={`${QUICK} ${monthEnd ? "border-primary/30 bg-primary-soft/60" : "border-outline/40 bg-surface-muted"}`}>
            Final do mês
          </button>
        )}
        {hint && <p className="m-0 flex-1 text-[12px] text-muted">{hint}</p>}
      </div>
    </div>
  );
}
