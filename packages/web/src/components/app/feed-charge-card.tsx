"use client";

import {
  type BadgeTone,
  billingCategoryColor,
  ChargeActionKind,
  ChargeState,
  chargeAction,
  chargeBadges,
  chargeFeedLine,
  chargeStateLabel,
  chargeSummaryOf,
  counterpartName,
  Direction,
  feedDayLabel,
  formatMoney,
  type ListChargeItem,
} from "@receivy/common";
import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { InitialsAvatar } from "../ui/initials-avatar";
import { StatusTag } from "../ui/status-tag";

/** The narrow row's second line is tinted text; `warning` is what the viewer pays, in the payable red. */
const LINE_CLASS: Record<BadgeTone, string> = {
  danger: "text-payable",
  info: "text-primary",
  warning: "text-payable",
  success: "text-success",
  neutral: "text-muted",
};

type ChargeCardProps = {
  charge: ListChargeItem;
  direction: Direction;
  today: string;
  /** "Lembrete enviado" once a reminder went out; the button stays disabled with that label. */
  reminded: string | null;
  onRemind: () => void;
  onMarkPaid: () => void;
  onDeclare: () => void;
};

export function FeedChargeCard({ charge, direction, today, reminded, onRemind, onMarkPaid, onDeclare }: ChargeCardProps) {
  const [confirmRemind, setConfirmRemind] = useState(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [confirmDeclare, setConfirmDeclare] = useState(false);
  const summary = chargeSummaryOf(charge);
  const badges = chargeBadges(summary, today, direction);
  const action = chargeAction(summary, direction);
  const settled = charge.state !== ChargeState.Pending;
  const amountClass = settled ? "text-muted" : direction === Direction.Receivable ? "text-ink" : "text-payable";
  const counterpart = counterpartName(charge);
  const line = chargeFeedLine(charge, today);

  // The whole row opens the charge through one stretched link. Nesting the action inside it would
  // not be accessible, so the link is a sibling overlay and the action is raised above it.
  return (
    <article
      className={`relative flex items-center gap-3 border-b border-outline/60 bg-surface px-[18px] py-3 md:gap-4 md:rounded-[18px] md:border md:border-outline md:py-4 ${settled ? "opacity-60 md:opacity-100" : ""}`}
    >
      <Link
        href={`/charges/${charge.id}`}
        aria-label={`Abrir cobrança ${charge.description}`}
        className="absolute inset-0 focus-visible:outline-[3px] focus-visible:outline-primary focus-visible:-outline-offset-2 md:rounded-[18px]"
      />

      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full md:hidden" style={{ backgroundColor: billingCategoryColor(charge.billing.category) }} />

      <span className="hidden md:block">
        <InitialsAvatar name={counterpart} size={44} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 truncate text-[14px] font-semibold text-ink md:text-[15.5px]">
          {charge.description} · <span className="font-semibold text-muted md:font-normal">{counterpart}</span>
        </p>
        <p className={`m-0 truncate text-[11.5px] font-medium md:hidden ${LINE_CLASS[line.tone]}`}>{line.text}</p>
        {badges.length > 0 && (
          <div className="hidden flex-wrap gap-1.5 md:flex">
            {badges.map((badge) => (
              <StatusTag key={badge.label} label={badge.label} tone={badge.tone} />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end md:w-[120px]">
        <strong className={`font-display text-[15px] font-bold tabular-nums md:text-[19px] ${amountClass}`}>{formatMoney(summary.amount)}</strong>
        <span className="hidden text-[11.5px] text-muted md:inline">{chargeStateLabel(summary, direction)}</span>
      </div>

      {action?.kind === ChargeActionKind.Remind && (
        <button
          type="button"
          disabled={reminded !== null}
          onClick={() => setConfirmRemind(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-primary-soft px-2.5 text-[11.5px] font-extrabold text-primary-strong disabled:opacity-60 md:h-10 md:rounded-xl md:bg-primary md:px-3.5 md:text-[13px] md:font-bold md:text-on-primary"
        >
          <Bell size={15} aria-hidden="true" className="hidden md:block" />
          {reminded ?? action.label}
        </button>
      )}
      {action?.kind === ChargeActionKind.MarkPaid && (
        <button
          type="button"
          onClick={() => setConfirmPaid(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}
      {action?.kind === ChargeActionKind.DeclarePayment && (
        <button
          type="button"
          onClick={() => setConfirmDeclare(true)}
          className="relative flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] bg-success-soft px-2.5 text-[11.5px] font-extrabold text-success md:h-10 md:rounded-xl md:px-3.5 md:text-[13px] md:font-bold"
        >
          <Check size={15} aria-hidden="true" className="hidden md:block" />
          {action.label}
        </button>
      )}

      {confirmRemind && (
        <ConfirmDialog
          title="Enviar lembrete?"
          icon={Bell}
          tone="primary"
          detail={
            <>
              <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted">PRÉVIA</span>
              <strong className="text-[13.5px] font-semibold text-ink">{charge.description}</strong>
              <span className="text-xs text-muted">
                {formatMoney(summary.amount)} · vence {feedDayLabel(charge.dueDate, today).toLowerCase()}
              </span>
            </>
          }
          explanation={`Avisa ${counterpart} por notificação no app ou por e-mail, com o link de pagamento e a chave Pix. Só um lembrete a cada 24 horas.`}
          confirmLabel="Enviar lembrete"
          onConfirm={() => {
            setConfirmRemind(false);
            onRemind();
          }}
          onCancel={() => setConfirmRemind(false)}
        />
      )}
      {confirmPaid && (
        <ConfirmDialog
          title="Marcar como paga?"
          icon={Check}
          tone="primary"
          explanation="Isso registra um pagamento integral e encerra a cobrança. Dá para reabrir depois."
          confirmLabel="Marcar paga"
          onConfirm={() => {
            setConfirmPaid(false);
            onMarkPaid();
          }}
          onCancel={() => setConfirmPaid(false)}
        />
      )}
      {confirmDeclare && (
        <ConfirmDialog
          title="Marcar como pago?"
          icon={Check}
          tone="primary"
          explanation={`${counterpart} vai receber um aviso para confirmar o recebimento.`}
          confirmLabel="Marcar pago"
          onConfirm={() => {
            setConfirmDeclare(false);
            onDeclare();
          }}
          onCancel={() => setConfirmDeclare(false)}
        />
      )}
    </article>
  );
}
