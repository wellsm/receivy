import { describe, expect, it } from 'vitest';
import { PaymentProvider, PixKeyType } from './contracts';
import { paymentMethodCopyValue, paymentMethodText } from './payment-method-text';

describe('paymentMethodText', () => {
  it('names a Pix key by its kind and masks the value', () => {
    expect(paymentMethodText({ provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '52998224725' })).toEqual({ title: 'CPF', value: '529.982.247-25' });
  });

  it('shows an InfiniteTag with its dollar sign', () => {
    expect(paymentMethodText({ provider: PaymentProvider.InfinitePay, kind: null, value: 'minha.loja' })).toEqual({ title: 'InfinitePay', value: '$minha.loja' });
  });

  it('names a PagBank account by its label and copies nothing', () => {
    expect(paymentMethodText({ provider: PaymentProvider.PagSeguro, kind: null, value: 'Conta da loja' })).toEqual({ title: 'PagBank', value: 'Conta da loja' });
    expect(paymentMethodCopyValue({ provider: PaymentProvider.PagSeguro, value: 'Conta da loja' })).toBe('');
  });
});

describe('paymentMethodCopyValue', () => {
  it('prefixes an InfiniteTag with its dollar sign', () => {
    expect(paymentMethodCopyValue({ provider: PaymentProvider.InfinitePay, value: 'minha.loja' })).toBe('$minha.loja');
  });

  it('copies a Pix key as-is', () => {
    expect(paymentMethodCopyValue({ provider: PaymentProvider.Pix, value: 'pix@example.com' })).toBe('pix@example.com');
  });
});
