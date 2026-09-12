"use client";

import { billingBadges, billingCategoryColor, billingDueLabel, billingShareAction, formatMoney, type BadgeTone, type BillingSummary } from "@receivy/common";
import { ChevronRight, Share2 } from "lucide-react";
import { CategoryIcon } from "@/components/ui/category-icon";

const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-red-50 text-red-700",
  info: "bg-blue-50 text-blue-800",
  warning: "bg-amber-50 text-amber-900",
  success: "bg-primary-soft/50 text-primary-strong",
  neutral: "bg-surface-muted text-muted",
};

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

/** One billing on the list: category, description, due label, badges, amount and the share action. Mirrors the mobile card. */
export function BillingCard({ billing, today, onShare, onOpen }: BillingCardProps) {
  const dueLabel = billingDueLabel(billing, today);
  const overdue = dueLabel.startsWith("Atrasado");
  const badges = billingBadges(billing);
  const occurrence = occurrenceLine(billing);
  const canShare = billingShareAction(billing) !== null;
  // A conta a pagar has no link to share: its action opens the billing.
  const payable = billing.direction === "payable";

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-outline/40 bg-surface p-4" aria-label={`Cobrança ${billing.description}`}>
      <button type="button" aria-label={`Abrir ${billing.description}`} onClick={() => onOpen(billing)} className="flex w-full items-center gap-3 text-left">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${billingCategoryColor(billing.category)}1F` }}
        >
          <CategoryIcon category={billing.category} size={20} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{billing.description}</span>
            <span className={`shrink-0 text-xs font-semibold ${overdue ? "text-red-700" : "text-muted"}`}>{dueLabel}</span>
          </span>

          {badges.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <span key={badge.label} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASS[badge.tone]}`}>
                  {badge.label}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>

      <div className="flex items-center justify-between border-t border-outline/30 pt-3">
        <div className="flex flex-col">
          <strong className="text-lg font-extrabold tracking-tight text-primary">{formatMoney(billing.total)}</strong>
          {occurrence && <span className="text-[11px] text-muted">{occurrence}</span>}
        </div>

        {canShare && (
          <button type="button" onClick={() => onShare(billing)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary-soft/40 px-3 text-xs font-bold text-primary-strong transition hover:bg-primary-soft/70">
            {payable ? <ChevronRight size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
            {payable ? "Ver conta" : "Compartilhar"}
          </button>
        )}
      </div>
    </article>
  );
}
