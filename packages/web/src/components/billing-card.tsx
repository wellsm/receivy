"use client";

import {
  billingBadges,
  billingCategoryLabel,
  billingDueLabel,
  billingShareAction,
  formatMoney,
  type BillingCategory,
  type BillingSummary,
} from "@receivy/common";
import { Car, Handshake, House, Pencil, Plane, Repeat, Share2, ShoppingCart, Tag, Utensils, type LucideIcon } from "lucide-react";

const CATEGORY_ICONS: Record<BillingCategory, LucideIcon> = {
  food: Utensils,
  transport: Car,
  groceries: ShoppingCart,
  subscription: Repeat,
  loan: Handshake,
  housing: House,
  travel: Plane,
  other: Tag,
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
  onEdit: (billing: BillingSummary) => void;
  onOpen: (billing: BillingSummary) => void;
};

export function BillingCard({ billing, today, onShare, onEdit, onOpen }: BillingCardProps) {
  const Icon = CATEGORY_ICONS[billing.category] ?? Tag;
  const dueLabel = billingDueLabel(billing, today);
  const overdue = dueLabel.startsWith("Atrasado");
  const badges = billingBadges(billing, today);
  const occurrence = occurrenceLine(billing);
  const canShare = billingShareAction(billing) !== null;

  return (
    <article className="billing-card" aria-label={`Cobrança ${billing.description}`}>
      <button type="button" className="billing-card-body" aria-label={`Abrir ${billing.description}`} onClick={() => onOpen(billing)}>
        <span className="billing-card-top">
          <span className="billing-card-icon" role="img" aria-label={billingCategoryLabel(billing.category)}>
            <Icon size={18} aria-hidden="true" />
          </span>
          <span className="billing-card-title">{billing.description}</span>
          <span className={overdue ? "billing-card-due is-overdue" : "billing-card-due"}>{dueLabel}</span>
        </span>
        <span className="feed-card-badges">
          {badges.map((badge) => (
            <span className={`feed-badge ${badge.tone}`} key={badge.label}>
              {badge.label}
            </span>
          ))}
        </span>
      </button>

      <div className="feed-card-divider" aria-hidden="true" />

      <div className="billing-card-bottom">
        <div className="billing-card-amount">
          <strong className="feed-amount">{formatMoney(billing.total)}</strong>
          {occurrence && <span className="billing-card-date">{occurrence}</span>}
        </div>
        <div className="billing-card-actions">
          {canShare && (
            <button type="button" className="feed-action" onClick={() => onShare(billing)}>
              <Share2 size={14} aria-hidden="true" />
              Compartilhar
            </button>
          )}
          <button type="button" className="feed-action" onClick={() => onEdit(billing)}>
            <Pencil size={14} aria-hidden="true" />
            Editar
          </button>
        </div>
      </div>
    </article>
  );
}
