import { describe, expect, it } from 'vitest';
import {
  addCentsToAmount,
  amountDigitsToInput,
  amountInputToDigits,
  calendarDate,
  formatAmountDigits,
  parseBRLCents,
  parsePercentageBasisPoints
} from './financial-form';

describe('parseBRLCents', () => {
  it.each([
    ['1.234,56', 123_456],
    ['1234,56', 123_456],
    ['1234,5', 123_450],
    ['0,01', 1],
    [' 25 ', 2_500]
  ])('parses %s without floating-point arithmetic', (input, expected) => {
    expect(parseBRLCents(input)).toBe(expected);
  });

  it.each([
    '1.2,34',
    '12,345',
    'R$ 10,00',
    '10.00',
    '1,2,3',
    '-1,00',
    ''
  ])('rejects malformed BRL input %s rather than partially parsing it', (input) => {
    expect(() => parseBRLCents(input)).toThrow('Informe um valor em reais');
  });

  it('rejects values outside the API safe-integer contract', () => {
    expect(() => parseBRLCents('90.071.992.547.409,92')).toThrow('O valor ultrapassa o limite permitido.');
  });
});

describe('calendarDate', () => {
  it('uses the requested civil timezone instead of UTC date truncation', () => {
    expect(calendarDate(new Date('2026-09-07T01:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09-06');
  });
});

describe('parsePercentageBasisPoints', () => {
  it.each([
    ['0', 0],
    ['33,33', 3_333],
    ['66.67', 6_667],
    ['100', 10_000]
  ])('parses the explicit percentage %s without rounding', (input, expected) => {
    expect(parsePercentageBasisPoints(input)).toBe(expected);
  });

  it.each([
    '33,333',
    '66.667',
    '1e2',
    '+10',
    '-0,004',
    '100,01',
    '',
    ' 33,33 '
  ])('rejects ambiguous or out-of-range percentage %s', (input) => {
    expect(() => parsePercentageBasisPoints(input)).toThrow('percentual');
  });
});

describe('amountInputToDigits', () => {
  it.each([
    ['1.234,56', '123456'],
    ['1234,56', '123456'],
    ['0,00', ''],
    ['', ''],
    ['00', '']
  ])('strips formatting from %s down to raw digits', (input, expected) => {
    expect(amountInputToDigits(input)).toBe(expected);
  });
});

describe('amountDigitsToInput', () => {
  it.each([
    ['', '0,00'],
    ['0', '0,00'],
    ['5', '0,05'],
    ['100', '1,00'],
    ['123456', '1234,56']
  ])('turns the digits %s into the bank-style amount %s', (digits, expected) => {
    expect(amountDigitsToInput(digits)).toBe(expected);
  });
});

describe('formatAmountDigits', () => {
  it.each([
    ['', '0,00'],
    ['100', '1,00'],
    ['123456', '1.234,56']
  ])('formats the digits %s with pt-BR thousand grouping as %s', (digits, expected) => {
    expect(formatAmountDigits(digits)).toBe(expected);
  });
});

describe('addCentsToAmount', () => {
  it('adds cents to an already formatted amount', () => {
    expect(addCentsToAmount('1,00', 1000)).toBe('11,00');
  });

  it('is tolerant of an empty or zeroed amount', () => {
    expect(addCentsToAmount('', 1000)).toBe('10,00');
    expect(addCentsToAmount('0,00', 1000)).toBe('10,00');
  });
});
