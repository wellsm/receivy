import { type BillingDetail, BillingDueRule, type BillingPatch, type BillingPixInput, BillingRecurrence } from './billing';
import { endOfMonth } from './billing-calendar';
import { type ChargeDetail, ChargeState, type PixSnapshot, ProofState } from './contracts';
import type { BillingSplit } from './split';

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
];

/** Every pending charge: what "Cancelar pendentes" cancels. */
export function pendingChargesOf(billing: Pick<BillingDetail, 'charges'>): ChargeDetail[] {
  return billing.charges.filter((charge) => charge.state === ChargeState.Pending);
}

/** What an edit with EditScope.CurrentMonth rewrites: pending, due after today within this month, no proof under way. */
export function editableMonthCharges(billing: Pick<BillingDetail, 'charges'>, today: string): ChargeDetail[] {
  const monthEnd = endOfMonth(today);

  return billing.charges.filter((charge) => {
    if (charge.state !== ChargeState.Pending) {
      return false;
    }

    if (charge.dueDate <= today || charge.dueDate > monthEnd) {
      return false;
    }

    return !charge.proof || charge.proof.state === ProofState.Rejected;
  });
}

function splitKey(split: BillingSplit): string {
  const parts = split.parts.map((part) => {
    const userId = 'userId' in part ? part.userId : '';
    const value = 'amountCents' in part ? part.amountCents : 'basisPoints' in part ? part.basisPoints : 'shares' in part ? part.shares : '';

    return `${part.kind}:${userId}:${value}`;
  });

  return `${split.mode}|${parts.sort().join(',')}`;
}

function pixKey(pix: BillingPixInput | PixSnapshot | null | undefined): string {
  return pix ? `${pix.keyType}:${pix.key}:${pix.label ?? ''}` : '';
}

/** True when a recorrente patch changes what its charges carry: text, amount, split, Pix, payee or due day. */
export function patchTouchesCharges(billing: BillingDetail, patch: BillingPatch): boolean {
  if (billing.recurrence !== BillingRecurrence.Indefinite) {
    return false;
  }

  const changes = [
    patch.description !== undefined && patch.description !== billing.description,
    patch.totalCents !== undefined && patch.totalCents !== billing.total.amountCents,
    patch.split !== undefined && splitKey(patch.split) !== splitKey(billing.split),
    patch.paymentMethodId !== undefined && patch.paymentMethodId !== billing.paymentMethodId,
    Boolean(patch.clearPaymentMethod) && Boolean(billing.paymentMethodId),
    patch.pix !== undefined && pixKey(patch.pix) !== pixKey(billing.pix),
    patch.contactId !== undefined && patch.contactId !== billing.contact?.id,
    patch.startDate !== undefined && patch.startDate !== billing.startDate,
    patch.dueRule !== undefined && patch.dueRule !== (billing.dueRule ?? BillingDueRule.Fixed)
  ];

  return changes.some(Boolean);
}

/** The edit form asks for the scope only when the answer changes something. */
export function shouldAskEditScope(billing: BillingDetail, patch: BillingPatch, today: string): boolean {
  if (!patchTouchesCharges(billing, patch)) {
    return false;
  }

  return editableMonthCharges(billing, today).length > 0;
}

export function editScopeExplanation(count: number, today: string): string {
  const month = MONTHS[Number(today.slice(5, 7)) - 1];

  if (count === 1) {
    return `1 cobrança de ${month} ainda não venceu.`;
  }

  return `${count} cobranças de ${month} ainda não venceram.`;
}
