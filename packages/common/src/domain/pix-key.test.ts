import { describe, expect, it } from 'vitest';
import { PixKeyType } from './contracts';
import { normalizePixKey } from './pix-key';

describe('Pix key validation', () => {
  it.each([
    [PixKeyType.Cpf, '529.982.247-25', '52998224725'],
    [PixKeyType.Cnpj, '04.252.011/0001-10', '04252011000110'],
    [PixKeyType.Email, '  PAGADOR@Example.COM ', 'pagador@example.com'],
    [PixKeyType.Phone, '+55 (11) 99876-5432', '+5511998765432'],
    [PixKeyType.Random, '123E4567-E89B-12D3-A456-426614174000', '123e4567-e89b-12d3-a456-426614174000']
  ] as const)('normalizes a valid %s key', (type, value, expected) => {
    expect(normalizePixKey(type, value)).toBe(expected);
  });

  it.each([
    [PixKeyType.Cpf, '529.982.247-24'],
    [PixKeyType.Cnpj, '04.252.011/0001-11'],
    [PixKeyType.Email, 'not-an-email'],
    [PixKeyType.Phone, '5511'],
    [PixKeyType.Random, 'not-a-uuid']
  ] as const)('rejects an invalid %s key', (type, value) => {
    expect(() => normalizePixKey(type, value)).toThrow('Chave Pix inválida.');
  });
});
