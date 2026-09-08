export type BillingCategory = 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';

export const BILLING_CATEGORIES: { value: BillingCategory; label: string }[] = [
  { value: 'food', label: 'Alimentação' },
  { value: 'transport', label: 'Transporte' },
  { value: 'groceries', label: 'Mercado' },
  { value: 'subscription', label: 'Assinatura' },
  { value: 'loan', label: 'Empréstimo' },
  { value: 'housing', label: 'Moradia' },
  { value: 'travel', label: 'Viagem' },
  { value: 'other', label: 'Outro' }
];

export function billingCategoryLabel(category: BillingCategory): string {
  const found = BILLING_CATEGORIES.find((entry) => entry.value === category);

  if (!found) {
    throw new RangeError('Categoria inválida.');
  }

  return found.label;
}

export function isBillingCategory(value: unknown): value is BillingCategory {
  return BILLING_CATEGORIES.some((entry) => entry.value === value);
}
