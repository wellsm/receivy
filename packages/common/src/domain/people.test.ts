import { describe, expect, it } from 'vitest';
import { normalizePerson } from './people';

describe('people', () => {
  it('allows a contact without an account or communication channel', () => {
    expect(normalizePerson({ name: '  Ana  Silva  ' })).toEqual({ name: 'Ana Silva' });
  });
  it('normalizes email and Brazilian phone without changing email aliases', () => {
    expect(normalizePerson({ name: 'Ana', email: ' ANA+CASA@Example.COM ', phone: '(11) 99999-1234' })).toEqual({
      name: 'Ana',
      email: 'ana+casa@example.com',
      phone: '+5511999991234'
    });
  });
  it.each([{ name: ' ' }, { name: 'Ana', email: 'bad' }, { name: 'Ana', phone: '123' }, { name: 'Ana', phone: 'ligue 11999991234' }])(
    'rejects invalid input %j',
    (input) => {
      expect(() => normalizePerson(input)).toThrow();
    }
  );
});
