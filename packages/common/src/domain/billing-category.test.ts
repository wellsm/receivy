import { describe, expect, it } from 'vitest';
import { BILLING_CATEGORIES, BillingCategory, billingCategoryColor, billingCategoryLabel, isBillingCategory } from './billing-category';

describe('billing categories', () => {
  it('lists the new categories before Outro', () => {
    expect(BILLING_CATEGORIES.map((entry) => entry.label)).toEqual([
      'Alimentação',
      'Transporte',
      'Mercado',
      'Assinatura',
      'Empréstimo',
      'Moradia',
      'Viagem',
      'Saúde',
      'Educação',
      'Lazer',
      'Outro'
    ]);
  });

  it('labels and tints the new categories', () => {
    expect(billingCategoryLabel(BillingCategory.Health)).toBe('Saúde');
    expect(billingCategoryLabel(BillingCategory.Education)).toBe('Educação');
    expect(billingCategoryLabel(BillingCategory.Leisure)).toBe('Lazer');
    expect(billingCategoryColor(BillingCategory.Health)).toBe('#D94F70');
    expect(billingCategoryColor(BillingCategory.Education)).toBe('#5B6BD6');
    expect(billingCategoryColor(BillingCategory.Leisure)).toBe('#C9971C');
    expect(isBillingCategory('health')).toBe(true);
  });
});
