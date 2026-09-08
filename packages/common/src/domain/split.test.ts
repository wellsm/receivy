import { describe, expect, it } from 'vitest';
import { resolveExpenseSplit } from './split';

const ana = { kind: 'person' as const, personId: 'ana' };
const bia = { kind: 'person' as const, personId: 'bia' };
const owner = { kind: 'owner' as const };

describe('expense split', () => {
  it('allocates the total before installments, keeping stable cent remainders', () => {
    expect(resolveExpenseSplit(100, 3, { mode: 'equal', parts: [ana, bia, owner] })).toEqual([
      { ...ana, amountCents: 34, installments: [12, 11, 11] },
      { ...bia, amountCents: 33, installments: [11, 11, 11] },
      { ...owner, amountCents: 33, installments: [11, 11, 11] }
    ]);
  });

  it('assigns the fixed remainder to the owner', () => {
    expect(
      resolveExpenseSplit(100, 2, {
        mode: 'fixed',
        parts: [
          { ...ana, amountCents: 41 },
          { ...bia, amountCents: 20 }
        ]
      })
    ).toEqual([
      { ...ana, amountCents: 41, installments: [21, 20] },
      { ...bia, amountCents: 20, installments: [10, 10] },
      { ...owner, amountCents: 39, installments: [20, 19] }
    ]);
  });

  it('awards percentage residuals by largest remainder, not input order', () => {
    expect(
      resolveExpenseSplit(101, 1, {
        mode: 'percentage',
        parts: [
          { ...ana, basisPoints: 2000 },
          { ...bia, basisPoints: 3000 },
          { ...owner, basisPoints: 5000 }
        ]
      }).map((part) => part.amountCents)
    ).toEqual([20, 30, 51]);
  });

  it('breaks percentage ties by stable allocation order', () => {
    expect(
      resolveExpenseSplit(1, 1, {
        mode: 'percentage',
        parts: [
          { ...ana, basisPoints: 5000 },
          { ...bia, basisPoints: 5000 }
        ]
      }).map((part) => part.amountCents)
    ).toEqual([1, 0]);
  });

  it('keeps products exact at the safe integer limit', () => {
    expect(
      resolveExpenseSplit(Number.MAX_SAFE_INTEGER, 1, {
        mode: 'percentage',
        parts: [
          { ...ana, basisPoints: 5000 },
          { ...bia, basisPoints: 5000 }
        ]
      }).map((part) => part.amountCents)
    ).toEqual([4503599627370496, 4503599627370495]);
  });

  it('preserves total and each participant across many cent and installment combinations', () => {
    for (let total = 1; total <= 301; total++) {
      for (const count of [1, 2, 3, 12]) {
        const result = resolveExpenseSplit(total, count, { mode: 'equal', parts: [ana, bia, owner] });
        expect(result.reduce((sum, part) => sum + part.amountCents, 0)).toBe(total);
        for (const part of result) {
          expect(part.installments).toHaveLength(count);
          expect(part.installments.reduce((sum, value) => sum + value, 0)).toBe(part.amountCents);
          expect(Math.max(...part.installments) - Math.min(...part.installments)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('rejects invalid totals and installment counts', () => {
    for (const total of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveExpenseSplit(total, 1, { mode: 'equal', parts: [ana] })).toThrow();
    }
    for (const count of [-1, 0, 1.5, NaN, Infinity, 1000]) {
      expect(() => resolveExpenseSplit(100, count, { mode: 'equal', parts: [ana] })).toThrow();
    }
  });

  it('rejects empty and repeated participants', () => {
    for (const parts of [[], [ana, ana], [owner, owner], [{ kind: 'person' as const, personId: '' }]]) {
      expect(() => resolveExpenseSplit(100, 1, { mode: 'equal', parts })).toThrow();
    }
  });

  it('rejects fixed allocations that exceed the total or use fractional cents', () => {
    for (const amountCents of [101, -1, 1.5, NaN]) {
      expect(() => resolveExpenseSplit(100, 1, { mode: 'fixed', parts: [{ ...ana, amountCents }] })).toThrow();
    }
  });

  it('requires exactly 10000 integer basis points', () => {
    for (const basisPoints of [9999, 10001, -1, 1.5, NaN]) {
      expect(() => resolveExpenseSplit(100, 1, { mode: 'percentage', parts: [{ ...ana, basisPoints }] })).toThrow();
    }
  });
});
