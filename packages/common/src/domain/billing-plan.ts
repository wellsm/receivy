import { type BillingSplit, type ResolvedAllocation, resolveBillingSplit } from './split';

export type BillingPlanInput = {
  description: string;
  totalCents: number;
  split: BillingSplit;
  dueDates: string[];
  /** `true` numbers charges k/N (once, until); `false` leaves both null (indefinite). */
  numbered: boolean;
};

export type PlannedCharge = {
  personId: string;
  description: string;
  amountCents: number;
  currency: 'BRL';
  dueDate: string;
  installment: number | null;
  installmentCount: number | null;
};

export type BillingPlan = {
  description: string;
  currency: 'BRL';
  totalCents: number;
  allocations: ResolvedAllocation[];
  charges: PlannedCharge[];
};

/** Pure preview; the API still verifies ownership and persists snapshots atomically. */
export function planBillingCharges(input: BillingPlanInput): BillingPlan {
  const description = input.description.normalize('NFC').trim();

  if (!description || description.length > 500) {
    throw new RangeError('Informe uma descrição de até 500 caracteres.');
  }

  const allocations = resolveBillingSplit(input.totalCents, input.split);
  const external = allocations.filter((allocation) => allocation.kind === 'person' && allocation.amountCents > 0);
  const charges: PlannedCharge[] = [];

  input.dueDates.forEach((dueDate, index) => {
    for (const allocation of external) {
      if (allocation.kind !== 'person') {
        continue;
      }

      charges.push({
        personId: allocation.personId,
        description,
        amountCents: allocation.amountCents,
        currency: 'BRL',
        dueDate,
        installment: input.numbered ? index + 1 : null,
        installmentCount: input.numbered ? input.dueDates.length : null
      });
    }
  });

  return { description, currency: 'BRL', totalCents: input.totalCents, allocations, charges };
}
