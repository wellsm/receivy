"use client";

import { billingBadges, billingCategoryColor, billingCategoryLabel, billingDueLabel, billingShareAction, formatMoney, type BadgeTone, type BillingSummary } from "@receivy/common";
import { ChevronRight, Share2 } from "lucide-react";
import { CategoryIcon } from "@/components/ui/category-icon";

const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  neutral: "bg-surface-muted text-muted",
};

/** From `md` the card is a table row: the list's header row shares these columns. */
export const BILLING_ROW_COLUMNS = "md:grid-cols-[minmax(0,1fr)_minmax(0,220px)_130px_120px_44px]";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** `2026-10-20` → `20/out`, the compact date the card shows next to the amount. */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");

  if (!month || !day) {
    return date;
  }

  return `${day}/${MONTHS[Number(month) - 1] ?? month}`;
}

function occurrenceLine(billing: BillingSummary): string | null {
  if (billing.state === "ended") {
    const last = billing.endDate ?? billing.nextDueDate;

    return last ? `Última ${shortDate(last)}` : null;
  }

  return billing.nextDueDate ? `Vencimento ${shortDate(billing.nextDueDate)}` : null;
}

type BillingCardProps = {
  billing: BillingSummary;
  today: string;
  onShare: (billing: BillingSummary) => void;
  onOpen: (billing: BillingSummary) => void;
};

/**
 * One billing on the list: category, description, badges, due label, amount and the share action. Mirrors the mobile card;
 * from `md` the same cells line up as a table row (the wrappers turn into `display: contents`).
 */
export function BillingCard({ billing, today, onShare, onOpen }: BillingCardProps) {
  const dueLabel = billingDueLabel(billing, today);
  const overdue = dueLabel.startsWith("Atrasado");
  const badges = billingBadges(billing);
  const occurrence = occurrenceLine(billing);
  const canShare = billingShareAction(billing) !== null;
  // A conta a pagar has no link to share: its action opens the billing.
  const payable = billing.direction === "payable";

  return (
    <article
      className={`flex flex-col gap-3 rounded-[20px] border border-outline bg-surface p-4 md:grid ${BILLING_ROW_COLUMNS} md:items-center md:gap-5 md:rounded-none md:border-0 md:border-b md:border-outline/60 md:px-[22px] md:py-4 md:last:border-b-0`}
      aria-label={`Cobrança ${billing.description}`}
    >
      <div className="flex items-center gap-3 md:contents">
        <button type="button" aria-label={`Abrir ${billing.description}`} onClick={() => onOpen(billing)} className="flex min-w-0 flex-1 items-center gap-3 text-left md:col-start-1 md:row-start-1 md:gap-[13px]">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] md:rounded-[13px]"
            style={{ backgroundColor: `${billingCategoryColor(billing.category)}18` }}
          >
            <CategoryIcon category={billing.category} size={20} />
          </span>

          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold text-ink md:text-[14.5px]">{billing.description}</span>
            <span className="mt-0.5 truncate text-xs text-muted md:text-[11.5px]">
              {billingCategoryLabel(billing.category)} · {payable ? "a pagar" : "a receber"}
            </span>
          </span>
        </button>

        <strong className={`shrink-0 font-display text-[17px] font-bold tabular-nums md:col-start-4 md:row-start-1 md:text-right md:text-[15.5px] ${payable ? "text-payable" : "text-ink"}`}>
          {formatMoney(billing.total)}
        </strong>
      </div>

      {badges.length > 0 && (
        <span className="flex flex-wrap gap-1.5 md:col-start-2 md:row-start-1">
          {badges.map((badge) => (
            <span key={badge.label} className={`inline-flex h-6 items-center rounded-lg px-[9px] text-[11px] font-semibold ${BADGE_CLASS[badge.tone]}`}>
              {badge.label}
            </span>
          ))}
        </span>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-outline/60 pt-3 md:contents">
        <div className="flex flex-col md:col-start-3 md:row-start-1">
          <span className={`text-xs font-semibold md:text-[12.5px] md:font-medium ${overdue ? "text-danger" : "text-muted"}`}>{dueLabel}</span>
          {occurrence && <span className="text-[11px] text-muted">{occurrence}</span>}
        </div>

        {canShare && (
          <button
            type="button"
            onClick={() => onShare(billing)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-outline px-[11px] text-xs font-bold text-ink transition hover:bg-surface-muted md:col-start-5 md:row-start-1 md:h-[34px] md:w-[34px] md:justify-center md:justify-self-end md:px-0"
          >
            {payable ? <ChevronRight size={14} aria-hidden="true" className="text-muted" /> : <Share2 size={13} aria-hidden="true" className="text-muted" />}
            <span className="md:sr-only">{payable ? "Ver conta" : "Compartilhar"}</span>
          </button>
        )}
      </div>
    </article>
  );
}
