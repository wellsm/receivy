import { type BillingContact, type BillingSummary, calendarDate, ChargeState } from '@receivy/common';
import { StoredProofState } from '../../charges/schemas/charge';
import type { BillingRepository } from '../repositories/billing';
import { billingDirection, billingKind, billingRecurrence } from './columns';
import { type BillingRow, installmentCountFor } from './split';

/** Card counters a list entry carries beyond the stored billing row. */
export type BillingCounters = {
  participantCount: number;
  chargeCount: number;
  paidCount: number;
  proofsPending: number;
  shareChargeId: string | null;
};

/** Everything a summary needs from the charges, allocations and proofs of one billing. */
export type SummaryAggregate = BillingCounters & { earliestPendingDue: string | null };

export const EMPTY_AGGREGATE: SummaryAggregate = {
  participantCount: 0,
  chargeCount: 0,
  paidCount: 0,
  proofsPending: 0,
  shareChargeId: null,
  earliestPendingDue: null
};

export type SummaryCharge = { id: string; billing_id: string; state: ChargeState; due_date: string; proofs?: { state: StoredProofState }[] | null };

export type SummaryAllocation = { billing_id: string; user_id: string };

/**
 * The counters of every billing of a page from two reads: the charges with their proof state, and the allocations.
 * `today` is per billing because the share candidate is timezone-bound: it prefers the nearest charge still due
 * and only falls back to the earliest overdue one.
 */
export function summaryAggregates(rows: BillingRow[], charges: SummaryCharge[], allocations: SummaryAllocation[], now: Date): Map<string, SummaryAggregate> {
  const result = new Map<string, SummaryAggregate>();

  for (const row of rows) {
    const today = calendarDate(now, row.timezone);
    const own = charges.filter((charge) => charge.billing_id === row.id);
    const pending = own.filter((charge) => charge.state === ChargeState.Pending);
    // The share action only makes sense while a single participant owns every charge; a conta a pagar names who
    // receives outside its split, so the card keeps counting participants only.
    const participants = row.contact_id
      ? new Set<string>()
      : new Set(allocations.filter((allocation) => allocation.billing_id === row.id && allocation.user_id !== row.owner_id).map((allocation) => allocation.user_id));
    const share = [...pending].sort((a, b) => {
      const aDue = a.due_date >= today ? 0 : 1;
      const bDue = b.due_date >= today ? 0 : 1;

      return aDue - bDue || (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })[0];

    result.set(row.id, {
      participantCount: participants.size,
      chargeCount: own.filter((charge) => charge.state !== ChargeState.Cancelled).length,
      paidCount: own.filter((charge) => charge.state === ChargeState.Paid).length,
      proofsPending: own.filter((charge) => charge.state !== ChargeState.Cancelled && charge.proofs?.some((proof) => proof.state === StoredProofState.Pending)).length,
      shareChargeId: participants.size === 1 && share ? share.id : null,
      earliestPendingDue: pending.map((charge) => charge.due_date).sort()[0] ?? null
    });
  }

  return result;
}

export function billingSummary(
  row: BillingRepository.Row,
  nextDueDate: string | null,
  counters: BillingCounters,
  contact: BillingContact | null,
  counterpart: BillingContact | null
): BillingSummary {
  return {
    id: row.id,
    type: billingDirection(row),
    contact,
    counterpart,
    kind: billingKind(row),
    recurrence: billingRecurrence(row),
    frequency: row.frequency,
    description: row.description,
    total: { amountCents: row.total_cents, currency: 'BRL' },
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule,
    state: row.state,
    installmentCount: installmentCountFor(row),
    nextDueDate,
    createdAt: row.created_at,
    category: row.category,
    ...counters
  };
}
