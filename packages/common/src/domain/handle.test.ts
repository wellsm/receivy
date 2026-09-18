import { describe, expect, it } from 'vitest';
import { normalizeHandle } from './handle';

describe('normalizeHandle', () => {
  it('strips the dollar sign, spaces and case', () => {
    expect(normalizeHandle(' $Minha.Loja_1 ')).toBe('minha.loja_1');
    expect(normalizeHandle('$$loja')).toBe('loja');
  });

  it('refuses what an InfiniteTag cannot be', () => {
    for (const value of ['', '$', 'a', 'com espaço', '-começa', 'x'.repeat(41), 'ação']) {
      expect(() => normalizeHandle(value)).toThrow('Handle inválido.');
    }
  });
});
