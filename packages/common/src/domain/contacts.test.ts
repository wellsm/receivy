import { describe, expect, it } from 'vitest';
import { normalizeContact } from './contacts';

describe('contacts', () => {
  it('normalizes the name and the e-mail without changing e-mail aliases', () => {
    expect(normalizeContact({ name: '  Ana  Silva  ', email: ' ANA+CASA@Example.COM ' })).toEqual({
      name: 'Ana Silva',
      email: 'ana+casa@example.com'
    });
  });
  it('normalizes the nickname and drops an empty one', () => {
    expect(normalizeContact({ name: 'Ana Silva', nickname: '  Aninha   Silva ', email: 'ana@example.com' })).toEqual({
      name: 'Ana Silva',
      nickname: 'Aninha Silva',
      email: 'ana@example.com'
    });
    expect(normalizeContact({ name: 'Ana Silva', nickname: '   ', email: 'ana@example.com' })).toEqual({
      name: 'Ana Silva',
      email: 'ana@example.com'
    });
  });
  it('rejects a nickname longer than 60 characters', () => {
    expect(() => normalizeContact({ name: 'Ana', nickname: 'a'.repeat(61), email: 'ana@example.com' })).toThrow(
      new RangeError('Informe um apelido com até 60 caracteres.')
    );
  });
  it('keeps a contact without e-mail: the person is reachable by link only', () => {
    expect(normalizeContact({ name: 'Ana', email: '' })).toEqual({ name: 'Ana' });
    expect(normalizeContact({ name: 'Ana' })).toEqual({ name: 'Ana' });
  });
  it.each([
    { name: ' ', email: 'ana@example.com' },
    { name: 'Ana', email: 'bad' },
    { name: 'a'.repeat(121), email: 'ana@example.com' }
  ])('rejects %j', (input) => {
    expect(() => normalizeContact(input)).toThrow();
  });
});
