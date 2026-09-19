import { describe, expect, it } from 'vitest';
import { PaymentProvider, PixKeyType } from './contracts';
import { paymentMethodText } from './payment-method-text';

describe('paymentMethodText', () => {
  it('names a Pix key by its kind and masks the value', () => {
    expect(paymentMethodText({ provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '52998224725' })).toEqual({ title: 'CPF', value: '529.982.247-25' });
  });

  it('shows an InfiniteTag with its dollar sign', () => {
    expect(paymentMethodText({ provider: PaymentProvider.InfinitePay, kind: null, value: 'minha.loja' })).toEqual({ title: 'InfinitePay', value: '$minha.loja' });
  });
});
