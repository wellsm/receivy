import { BillingKind, BillingRecurrence, type NormalizedBillingInput, SplitPartKind } from './billing';
import { billingDueDates } from './billing-calendar';
import { type BillingDraft, buildBillingInput } from './billing-draft';
import { type PlannedCharge, planBillingCharges } from './billing-plan';
import { ChargePayer, Direction } from './contracts';
import type { ResolvedAllocation } from './split';

export type BillingDraftSummary = {
  charges: number;
  people: number;
  /** Due dates for a finite billing; null for a recorrente sem fim, which is generated one month at a time. */
  occurrences: number | null;
  totalCents: number;
  /** Total of a single due date: equal to `totalCents` for `once`. */
  perOccurrenceCents: number;
};

/** Participants who actually get a charge: the owner part never counts, nor does an amount rounded to zero. */
function summaryPeople(input: NormalizedBillingInput, allocations: ResolvedAllocation[]): number {
  if (input.kind === BillingKind.Record) {
    return 0;
  }

  if (input.type === Direction.Payable) {
    return input.contactId ? 1 : 0;
  }

  return allocations.filter((allocation) => allocation.kind === SplitPartKind.User && allocation.amountCents > 0).length;
}

/** Stands in for the contact a conta a pagar has not picked yet, so the footer can still price the draft. */
const SEAT_PREVIEW = 'seat-preview';

function sumCents(charges: PlannedCharge[]): number {
  return charges.reduce((total, charge) => total + charge.amountCents, 0);
}

/**
 * The new-billing form footer: how many charges the API will create, for how many people and (finite
 * types) how many months, using the exact rules the API applies (`buildBillingInput` →
 * `normalizeBillingInput` → `billingDueDates` / `planBillingCharges`). Returns null while the draft is
 * not valid yet, same as a form that has nothing to submit.
 */
export function billingDraftSummary(draft: BillingDraft, today: Date): BillingDraftSummary | null {
  // A conta a pagar cannot be saved before it names who receives, but the footer prices it while the
  // seat is still empty: the plan is the same whoever sits there, one charge per due date on the owner.
  const seatless = draft.direction === Direction.Payable && !draft.payee;

  try {
    // `buildBillingInput` always returns `normalizeBillingInput`'s result; its declared type is
    // widened to `BillingInput` because it also doubles as the request body sent over the wire.
    const input = buildBillingInput(seatless ? { ...draft, payee: SEAT_PREVIEW } : draft, today) as NormalizedBillingInput;
    const payer = input.type === Direction.Payable ? ChargePayer.Owner : ChargePayer.Person;
    // The receiving contact stands for the person on the other side: one charge per due date, as the API plans it.
    const payeeUserId = seatless ? null : (input.contactId ?? null);
    const people = (allocations: ResolvedAllocation[]) => (seatless ? 0 : summaryPeople(input, allocations));
    const settled = input.kind === BillingKind.Record;

    if (input.recurrence === BillingRecurrence.Indefinite) {
      const plan = planBillingCharges({
        description: input.description,
        totalCents: input.totalCents,
        split: input.split,
        dueDates: [input.startDate],
        numbered: false,
        payer,
        payeeUserId,
        settled
      });
      const perOccurrenceCents = sumCents(plan.charges);

      return {
        charges: plan.charges.length,
        people: people(plan.allocations),
        occurrences: null,
        totalCents: perOccurrenceCents,
        perOccurrenceCents
      };
    }

    const dueDates = billingDueDates(input);
    const plan = planBillingCharges({
      description: input.description,
      totalCents: input.totalCents,
      split: input.split,
      dueDates,
      numbered: true,
      payer,
      payeeUserId,
      settled
    });
    const perOccurrenceCents = sumCents(plan.charges.filter((charge) => charge.dueDate === dueDates[0]));

    return {
      charges: plan.charges.length,
      people: people(plan.allocations),
      occurrences: dueDates.length,
      totalCents: sumCents(plan.charges),
      perOccurrenceCents
    };
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }

    throw error;
  }
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

/** Shared pt-BR copy for the footer; money formatting stays with each UI's own money formatter. */
export function billingDraftSummaryText(summary: BillingDraftSummary): string {
  const charges = pluralize(summary.charges, 'cobrança', 'cobranças');
  const occurrences = summary.occurrences;

  if (occurrences === null) {
    const perMonth = `Gera ${charges} por mês`;

    return summary.people === 0 ? perMonth : `${perMonth} · ${pluralize(summary.people, 'pessoa', 'pessoas')}`;
  }

  if (summary.people === 0) {
    return `Gera ${charges}`;
  }

  const people = pluralize(summary.people, 'pessoa', 'pessoas');

  // A single due date reads oddly with "× 1 mês" attached; the charge count already says it all.
  if (occurrences === 1) {
    return `Gera ${charges} · ${people}`;
  }

  return `Gera ${charges} · ${people} × ${pluralize(occurrences, 'mês', 'meses')}`;
}
