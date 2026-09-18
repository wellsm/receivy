import { describe, expect, it } from 'vitest';
import { SplitPartKind } from './billing';
import { SplitMode } from './contracts';
import { resolveBillingSplit, type SplitParty } from './split';

const ana = { kind: SplitPartKind.User, userId: 'ana' } satisfies SplitParty;
const bia = { kind: SplitPartKind.User, userId: 'bia' } satisfies SplitParty;
const owner = { kind: SplitPartKind.Owner } satisfies SplitParty;

describe('billing split', () => {
  it('distributes the occurrence amount with stable cent remainders', () => {
    expect(resolveBillingSplit(100, { mode: SplitMode.Equal, parts: [ana, bia, owner] })).toEqual([
      { ...ana, amountCents: 34 },
      { ...bia, amountCents: 33 },
      { ...owner, amountCents: 33 }
    ]);
  });

  it('assigns the fixed remainder to the owner', () => {
    expect(
      resolveBillingSplit(100, {
        mode: SplitMode.Fixed,
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
        mode: SplitMode.Percentage,
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
        mode: SplitMode.Percentage,
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
        mode: SplitMode.Percentage,
        parts: [
          { ...ana, basisPoints: 5000 },
          { ...bia, basisPoints: 5000 }
        ]
      }).map((part) => part.amountCents)
    ).toEqual([4503599627370496, 4503599627370495]);
  });

  it('preserves total and each participant across many cent combinations', () => {
    for (let total = 1; total <= 301; total++) {
      const result = resolveBillingSplit(total, { mode: SplitMode.Equal, parts: [ana, bia, owner] });

      expect(result.reduce((sum, part) => sum + part.amountCents, 0)).toBe(total);
      expect(Math.max(...result.map((part) => part.amountCents)) - Math.min(...result.map((part) => part.amountCents))).toBeLessThanOrEqual(
        1
      );
    }
  });

  it('rejects invalid totals', () => {
    for (const total of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveBillingSplit(total, { mode: SplitMode.Equal, parts: [ana] })).toThrow();
    }
  });

  it('rejects empty and repeated participants', () => {
    for (const parts of [[], [ana, ana], [owner, owner], [{ kind: SplitPartKind.User, userId: '' } satisfies SplitParty]]) {
      expect(() => resolveBillingSplit(100, { mode: SplitMode.Equal, parts })).toThrow();
    }
  });

  it('rejects fixed allocations that exceed the total or use fractional cents', () => {
    for (const amountCents of [101, -1, 1.5, NaN]) {
      expect(() => resolveBillingSplit(100, { mode: SplitMode.Fixed, parts: [{ ...ana, amountCents }] })).toThrow();
    }
  });

  it('requires exactly 10000 integer basis points', () => {
    for (const basisPoints of [9999, 10001, -1, 1.5, NaN]) {
      expect(() => resolveBillingSplit(100, { mode: SplitMode.Percentage, parts: [{ ...ana, basisPoints }] })).toThrow();
    }
  });

  it('splits by shares with largest remainder', () => {
    const parts = [
      { kind: SplitPartKind.User, userId: 'a', shares: 2 },
      { kind: SplitPartKind.User, userId: 'b', shares: 2 },
      { kind: SplitPartKind.User, userId: 'c', shares: 1 },
      { kind: SplitPartKind.User, userId: 'd', shares: 1 },
      { kind: SplitPartKind.User, userId: 'e', shares: 1 },
      { kind: SplitPartKind.User, userId: 'f', shares: 1 }
    ];

    expect(resolveBillingSplit(80_000, { mode: SplitMode.Shares, parts }).map((p) => p.amountCents)).toEqual([
      20_000, 20_000, 10_000, 10_000, 10_000, 10_000
    ]);
    expect(resolveBillingSplit(100, { mode: SplitMode.Shares, parts: parts.slice(0, 3) }).map((p) => p.amountCents)).toEqual([40, 40, 20]);
    expect(() => resolveBillingSplit(100, { mode: SplitMode.Shares, parts: [{ kind: SplitPartKind.Owner, shares: 0 }] })).toThrow(
      'Informe cotas inteiras de 1 a 1000.'
    );
    expect(() => resolveBillingSplit(100, { mode: SplitMode.Shares, parts: [{ kind: SplitPartKind.Owner, shares: 1001 }] })).toThrow(
      'Informe cotas inteiras de 1 a 1000.'
    );
  });

  it('carries the notify flag of a participant and refuses anything but a boolean', () => {
    expect(resolveBillingSplit(100, { mode: SplitMode.Equal, parts: [{ ...ana, notify: false }, owner] })).toEqual([
      { ...ana, notify: false, amountCents: 50 },
      { ...owner, amountCents: 50 }
    ]);
    expect(resolveBillingSplit(100, { mode: SplitMode.Fixed, parts: [{ ...bia, notify: true, amountCents: 40 }] })).toEqual([
      { ...bia, notify: true, amountCents: 40 },
      { ...owner, amountCents: 60 }
    ]);
    expect(() => resolveBillingSplit(100, { mode: SplitMode.Equal, parts: [{ ...ana, notify: 'yes' as unknown as boolean }] })).toThrow(
      'Participante inválido.'
    );
  });
});
