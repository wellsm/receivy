import { describe, expect, it } from 'vitest';
import { contactBadge, formatCnpj, formatCpf, formatPhoneBR, initialsOf, onlyDigits, pixKeyField } from './contact-format';

describe('contact format', () => {
  it('keeps only digits', () => {
    expect(onlyDigits('(11) 98765-4321')).toBe('11987654321');
    expect(onlyDigits('+55 11 98765.4321')).toBe('5511987654321');
    expect(onlyDigits('')).toBe('');
  });

  it('formats Brazilian phones with and without the country code', () => {
    expect(formatPhoneBR('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhoneBR('1187654321')).toBe('(11) 8765-4321');
    expect(formatPhoneBR('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatPhoneBR('551187654321')).toBe('(11) 8765-4321');
  });

  it('formats a phone progressively while it is typed', () => {
    expect(formatPhoneBR('')).toBe('');
    expect(formatPhoneBR('1')).toBe('(1');
    expect(formatPhoneBR('11')).toBe('(11');
    expect(formatPhoneBR('119')).toBe('(11) 9');
    expect(formatPhoneBR('1198765')).toBe('(11) 9876-5');
    expect(formatPhoneBR('119876543219999')).toBe('(11) 98765-4321');
  });

  it('formats CPF progressively', () => {
    expect(formatCpf('')).toBe('');
    expect(formatCpf('123')).toBe('123');
    expect(formatCpf('1234')).toBe('123.4');
    expect(formatCpf('1234567')).toBe('123.456.7');
    expect(formatCpf('12345678901')).toBe('123.456.789-01');
    expect(formatCpf('123456789012345')).toBe('123.456.789-01');
  });

  it('formats CNPJ progressively', () => {
    expect(formatCnpj('')).toBe('');
    expect(formatCnpj('12')).toBe('12');
    expect(formatCnpj('123')).toBe('12.3');
    expect(formatCnpj('123456789')).toBe('12.345.678/9');
    expect(formatCnpj('12345678000199')).toBe('12.345.678/0001-99');
    expect(formatCnpj('123456780001999999')).toBe('12.345.678/0001-99');
  });

  it('describes the CPF field', () => {
    const field = pixKeyField('cpf');
    expect(field.label).toBe('CPF do titular');
    expect(field.placeholder).toBe('000.000.000-00');
    expect(field.keyboard).toBe('numeric');
    expect(field.format('12345678901')).toBe('123.456.789-01');
    expect(field.unformat('123.456.789-01')).toBe('12345678901');
  });

  it('describes the CNPJ field', () => {
    const field = pixKeyField('cnpj');
    expect(field.label).toBe('CNPJ');
    expect(field.placeholder).toBe('00.000.000/0000-00');
    expect(field.keyboard).toBe('numeric');
    expect(field.format('12345678000199')).toBe('12.345.678/0001-99');
    expect(field.unformat('12.345.678/0001-99')).toBe('12345678000199');
  });

  it('describes the phone field and sends the country code the API expects', () => {
    const field = pixKeyField('phone');
    expect(field.label).toBe('Telefone celular');
    expect(field.placeholder).toBe('(00) 00000-0000');
    expect(field.keyboard).toBe('tel');
    expect(field.format('11987654321')).toBe('(11) 98765-4321');
    expect(field.unformat('(11) 98765-4321')).toBe('+5511987654321');
    expect(field.unformat('+55 11 98765-4321')).toBe('+5511987654321');
    expect(field.unformat('')).toBe('');
  });

  it('describes the email field', () => {
    const field = pixKeyField('email');
    expect(field.label).toBe('E-mail Pix');
    expect(field.placeholder).toBe('seu.email@exemplo.com.br');
    expect(field.keyboard).toBe('email');
    expect(field.format(' ana@example.com')).toBe(' ana@example.com');
    expect(field.unformat(' ana@example.com ')).toBe('ana@example.com');
  });

  it('describes the random key field', () => {
    const field = pixKeyField('random');
    expect(field.label).toBe('Chave aleatória');
    expect(field.placeholder).toBe('89a456bc-1234-…');
    expect(field.keyboard).toBe('text');
    expect(field.format('89a456bc-1234')).toBe('89a456bc-1234');
    expect(field.unformat(' 89a456bc-1234 ')).toBe('89a456bc-1234');
  });

  it('builds initials from the first two words', () => {
    expect(initialsOf('Camila Soares')).toBe('CS');
    expect(initialsOf('Ana')).toBe('A');
    expect(initialsOf('  ana  maria  de souza ')).toBe('AM');
    expect(initialsOf('')).toBe('');
  });

  it('builds the pending badge from the active charge count', () => {
    expect(contactBadge(0)).toEqual({ label: 'Sem pendências', tone: 'success' });
    expect(contactBadge(1)).toEqual({ label: '1 ativa', tone: 'warning' });
    expect(contactBadge(4)).toEqual({ label: '4 ativas', tone: 'warning' });
  });
});
