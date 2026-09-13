export const enum BillingCategory {
  Food = 'food',
  Transport = 'transport',
  Groceries = 'groceries',
  Subscription = 'subscription',
  Loan = 'loan',
  Housing = 'housing',
  Travel = 'travel',
  Health = 'health',
  Education = 'education',
  Leisure = 'leisure',
  Other = 'other'
}

export const BILLING_CATEGORIES: { value: BillingCategory; label: string }[] = [
  { value: BillingCategory.Food, label: 'Alimentação' },
  { value: BillingCategory.Transport, label: 'Transporte' },
  { value: BillingCategory.Groceries, label: 'Mercado' },
  { value: BillingCategory.Subscription, label: 'Assinatura' },
  { value: BillingCategory.Loan, label: 'Empréstimo' },
  { value: BillingCategory.Housing, label: 'Moradia' },
  { value: BillingCategory.Travel, label: 'Viagem' },
  { value: BillingCategory.Health, label: 'Saúde' },
  { value: BillingCategory.Education, label: 'Educação' },
  { value: BillingCategory.Leisure, label: 'Lazer' },
  { value: BillingCategory.Other, label: 'Outro' }
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
  health: '#D94F70',
  education: '#5B6BD6',
  leisure: '#C9971C',
  other: '#64748B'
};

export function billingCategoryColor(category: BillingCategory): string {
  return BILLING_CATEGORY_COLORS[category] ?? BILLING_CATEGORY_COLORS.other;
}
