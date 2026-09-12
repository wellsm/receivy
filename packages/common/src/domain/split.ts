export type SplitParty = { kind: 'owner' } | { kind: 'user'; userId: string };

export type BillingSplit =
  | { mode: 'equal'; parts: SplitParty[] }
  // Keep schema-visible unions explicit: EZ4 cannot extract object/union intersections.
  | { mode: 'percentage'; parts: ({ kind: 'owner'; basisPoints: number } | { kind: 'user'; userId: string; basisPoints: number })[] }
  | { mode: 'fixed'; parts: { kind: 'user'; userId: string; amountCents: number }[] }
  | { mode: 'shares'; parts: ({ kind: 'owner'; shares: number } | { kind: 'user'; userId: string; shares: number })[] };

export type ResolvedAllocation = SplitParty & { amountCents: number };

/** Resolves one occurrence. Every occurrence of a billing repeats this exact result. */
export function resolveBillingSplit(totalCents: number, split: BillingSplit): ResolvedAllocation[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('Total inválido.');
  }

  if (split.parts.length === 0 || split.parts.length > 100) {
    throw new RangeError('Informe de 1 a 100 participantes.');
  }

  const keys = new Set<string>();

  for (const part of split.parts) {
    if (part.kind !== 'owner' && part.kind !== 'user') {
      throw new RangeError('Participante inválido.');
    }

    if (part.kind === 'user' && (typeof part.userId !== 'string' || !part.userId.trim())) {
      throw new RangeError('Contato inválido.');
    }

    const key = part.kind === 'owner' ? 'owner' : `user:${part.userId}`;

    if (keys.has(key)) {
      throw new RangeError('Participante repetido.');
    }

    keys.add(key);
  }

  const parties: SplitParty[] = split.parts.map((part) =>
    part.kind === 'owner' ? { kind: 'owner' } : { kind: 'user', userId: part.userId }
  );

  const amounts = resolveAmounts(totalCents, split, parties);

  return parties.map((party, index) => ({ ...party, amountCents: amounts[index]! }));
}

function resolveAmounts(totalCents: number, split: BillingSplit, parties: SplitParty[]): number[] {
  if (split.mode === 'fixed') {
    const amounts = split.parts.map((part) => {
      if (part.kind !== 'user' || !Number.isSafeInteger(part.amountCents) || part.amountCents < 0) {
        throw new RangeError('Valor de participante inválido.');
      }

      return part.amountCents;
    });

    const used = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);

    if (used > BigInt(totalCents)) {
      throw new RangeError('O rateio ultrapassa o total.');
    }

    parties.push({ kind: 'owner' });
    amounts.push(Number(BigInt(totalCents) - used));

    return amounts;
  }

  if (split.mode === 'equal') {
    return distribute(
      totalCents,
      split.parts.map(() => 1)
    );
  }

  if (split.mode === 'percentage') {
    const weights = split.parts.map((part) => part.basisPoints);
    const invalid = weights.some((weight) => !Number.isInteger(weight) || weight < 0 || weight > 10000);

    if (invalid || weights.reduce((sum, weight) => sum + weight, 0) !== 10000) {
      throw new RangeError('Os percentuais devem somar 100%.');
    }

    return distribute(totalCents, weights);
  }

  if (split.mode === 'shares') {
    const shares = split.parts.map((part) => part.shares);
    const invalid = shares.some((share) => !Number.isInteger(share) || share < 1 || share > 1000);

    if (invalid) {
      throw new RangeError('Informe cotas inteiras de 1 a 1000.');
    }

    return distribute(totalCents, shares);
  }

  throw new RangeError('Modo de rateio inválido.');
}

function distribute(total: number, weights: number[]): number[] {
  const denominator = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const products = weights.map((weight) => BigInt(total) * BigInt(weight));
  const values = products.map((product) => Number(product / denominator));

  let residual = BigInt(total) - values.reduce((sum, value) => sum + BigInt(value), 0n);

  const ranked = products
    .map((product, index) => ({ index, remainder: product % denominator }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));

  for (const { index } of ranked) {
    if (residual === 0n) {
      break;
    }

    values[index] = values[index]! + 1;
    residual--;
  }

  return values;
}
