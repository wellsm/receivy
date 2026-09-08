import { describe, expect, it } from 'vitest';
import { resolveBillingSplit } from './split';

const ana = { kind: 'person' as const, personId: 'ana' };
const bia = { kind: 'person' as const, personId: 'bia' };
const owner = { kind: 'owner' as const };

describe('billing split', () => {
  it('distributes the occurrence amount with stable cent remainders', () => {
    expect(resolveBillingSplit(100, { mode: 'equal', parts: [ana, bia, owner] })).toEqual([
      { ...ana, amountCents: 34 },
      { ...bia, amountCents: 33 },
      { ...owner, amountCents: 33 }
    ]);
  });

  it('assigns the fixed remainder to the owner', () => {
    expect(
      resolveBillingSplit(100, {
        mode: 'fixed',
        parts: [
          { ...ana, amountCents: 41 },
          { ...bia, amountCents: 20 }
        ]
      })
    ).toEqual([
      { ...ana, amountCents: 41 },
      { ...bia, amountCents: 20 },
      { ...owner, amountCents: 39 }
    ]);
  });

  it('awards percentage residuals by largest remainder, not input order', () => {
    expect(
      resolveBillingSplit(101, {
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
      resolveBillingSplit(1, {
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
      resolveBillingSplit(Number.MAX_SAFE_INTEGER, {
        mode: 'percentage',
        parts: [
          { ...ana, basisPoints: 5000 },
          { ...bia, basisPoints: 5000 }
        ]
      }).map((part) => part.amountCents)
    ).toEqual([4503599627370496, 4503599627370495]);
  });

  it('preserves total and each participant across many cent combinations', () => {
    for (let total = 1; total <= 301; total++) {
      const result = resolveBillingSplit(total, { mode: 'equal', parts: [ana, bia, owner] });
      expect(result.reduce((sum, part) => sum + part.amountCents, 0)).toBe(total);
      expect(Math.max(...result.map((part) => part.amountCents)) - Math.min(...result.map((part) => part.amountCents))).toBeLessThanOrEqual(
        1
      );
    }
  });

  it('rejects invalid totals', () => {
    for (const total of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveBillingSplit(total, { mode: 'equal', parts: [ana] })).toThrow();
    }
  });

  it('rejects empty and repeated participants', () => {
    for (const parts of [[], [ana, ana], [owner, owner], [{ kind: 'person' as const, personId: '' }]]) {
      expect(() => resolveBillingSplit(100, { mode: 'equal', parts })).toThrow();
    }
  });

  it('rejects fixed allocations that exceed the total or use fractional cents', () => {
    for (const amountCents of [101, -1, 1.5, NaN]) {
      expect(() => resolveBillingSplit(100, { mode: 'fixed', parts: [{ ...ana, amountCents }] })).toThrow();
    }
  });

  it('requires exactly 10000 integer basis points', () => {
    for (const basisPoints of [9999, 10001, -1, 1.5, NaN]) {
      expect(() => resolveBillingSplit(100, { mode: 'percentage', parts: [{ ...ana, basisPoints }] })).toThrow();
    }
  });
});
