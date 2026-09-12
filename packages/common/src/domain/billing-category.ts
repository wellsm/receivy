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

/**
 * One tint per category so lists and pickers do not read as a single green block.
 * Hex (not Tailwind classes) because React Native tints icons with a raw colour.
 */
export const BILLING_CATEGORY_COLORS: Record<BillingCategory, string> = {
  food: '#E8833A',
  transport: '#3D7EC9',
  groceries: '#2FA36B',
  subscription: '#8257E6',
  loan: '#0FA3A3',
  housing: '#C2544D',
  travel: '#D6538C',
  other: '#64748B'
};

export function billingCategoryColor(category: BillingCategory): string {
  return BILLING_CATEGORY_COLORS[category] ?? BILLING_CATEGORY_COLORS.other;
}
