import { PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { normalizePaymentMethod } from './input';

describe('normalizePaymentMethod', () => {
  it('normalizes a Pix key by its kind and defaults the label', () => {
    expect(normalizePaymentMethod({ provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: ' Ana@Example.com ' })).toEqual({
      provider: PaymentProvider.Pix,
      kind: PixKeyType.Email,
      value: 'ana@example.com',
      label: 'Pix'
    });
  });

  it('normalizes an InfiniteTag and defaults its label', () => {
    expect(normalizePaymentMethod({ provider: PaymentProvider.InfinitePay, value: '$Minha.Loja' })).toEqual({
      provider: PaymentProvider.InfinitePay,
      kind: null,
      value: 'minha.loja',
      label: 'InfinitePay'
    });
  });

  it('refuses a Pix input without a kind and an oversized label', () => {
    expect(() => normalizePaymentMethod({ provider: PaymentProvider.Pix, value: 'x' } as never)).toThrow('Chave Pix inválida.');
    expect(() => normalizePaymentMethod({ provider: PaymentProvider.InfinitePay, value: 'loja', label: 'x'.repeat(121) })).toThrow('Rótulo inválido.');
  });

  it('defaults a PagBank method to the "PagBank" label when none is given', () => {
    expect(normalizePaymentMethod({ provider: PaymentProvider.PagSeguro, token: 'tok' })).toEqual({
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'PagBank',
      label: 'PagBank'
    });
  });

  it('uses the given label as both value and label for a PagBank method', () => {
    expect(normalizePaymentMethod({ provider: PaymentProvider.PagSeguro, token: 'tok', label: ' Minha Conta ' })).toEqual({
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'Minha Conta',
      label: 'Minha Conta'
    });
  });
});
