import { SplitPartKind } from './billing';
import { ChargePayer } from './contracts';
import { type BillingSplit, type ResolvedAllocation, resolveBillingSplit } from './split';

export type BillingPlanInput = {
  description: string;
  totalCents: number;
  split: BillingSplit;
  dueDates: string[];
  /** `true` numbers charges k/N (once, until); `false` leaves both null (indefinite). */
  numbered: boolean;
  /** `owner` plans a conta a pagar: one charge per due date for the whole total, the owner paying. Defaults to `person`. */
  payer?: ChargePayer;
  /** Conta a pagar only: the contact who receives, or null when the bill is the owner's alone. */
  payeeUserId?: string | null;
};

export type PlannedCharge = {
  /** The contact on the other side; null only on a conta a pagar without a payee. */
  userId: string | null;
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
  const charges: PlannedCharge[] = [];
  const numbering = (index: number) => ({
    installment: input.numbered ? index + 1 : null,
    installmentCount: input.numbered ? input.dueDates.length : null
  });

  if (input.payer === ChargePayer.Owner) {
    input.dueDates.forEach((dueDate, index) => {
      charges.push({
        userId: input.payeeUserId ?? null,
        description,
        amountCents: input.totalCents,
        currency: 'BRL',
        dueDate,
        ...numbering(index)
      });
    });

    return { description, currency: 'BRL', totalCents: input.totalCents, allocations, charges };
  }

  const external = allocations.filter((allocation) => allocation.kind === SplitPartKind.User && allocation.amountCents > 0);

  input.dueDates.forEach((dueDate, index) => {
    for (const allocation of external) {
      if (allocation.kind !== SplitPartKind.User) {
        continue;
      }

      charges.push({
        userId: allocation.userId,
        description,
        amountCents: allocation.amountCents,
        currency: 'BRL',
        dueDate,
        ...numbering(index)
      });
    }
  });

  return { description, currency: 'BRL', totalCents: input.totalCents, allocations, charges };
}
