export type SplitParty = { kind: "owner" } | { kind: "person"; personId: string };

export type ExpenseSplit =
  | { mode: "equal"; parts: SplitParty[] }
  | { mode: "percentage"; parts: (SplitParty & { basisPoints: number })[] }
  | { mode: "fixed"; parts: ({ kind: "person"; personId: string; amountCents: number })[] };

export type ResolvedAllocation = SplitParty & {
  amountCents: number;
  installments: number[];
};

export function resolveExpenseSplit(
  totalCents: number,
  installmentCount: number,
  split: ExpenseSplit,
): ResolvedAllocation[] {
  // Explicit bounds prevent accidentally allocating unbounded preview arrays.
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new RangeError("Total inválido.");
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 360) {
    throw new RangeError("Informe entre 1 e 360 parcelas.");
  }
  if (split.parts.length === 0 || split.parts.length > 100) throw new RangeError("Informe de 1 a 100 participantes.");

  const keys = new Set<string>();
  for (const part of split.parts) {
    if (part.kind !== "owner" && part.kind !== "person") throw new RangeError("Participante inválido.");
    if (part.kind === "person" && (typeof part.personId !== "string" || !part.personId.trim())) {
      throw new RangeError("Contato inválido.");
    }
    const key = part.kind === "owner" ? "owner" : `person:${part.personId}`;
    if (keys.has(key)) throw new RangeError("Participante repetido.");
    keys.add(key);
  }

  let amounts: number[];
  let parties: SplitParty[] = split.parts.map(part => part.kind === "owner"
    ? { kind: "owner" } : { kind: "person", personId: part.personId });
  if (split.mode === "fixed") {
    amounts = split.parts.map(part => {
      if (part.kind !== "person" || !Number.isSafeInteger(part.amountCents) || part.amountCents < 0) {
        throw new RangeError("Valor de participante inválido.");
      }
      return part.amountCents;
    });
    const used = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
    if (used > BigInt(totalCents)) throw new RangeError("O rateio ultrapassa o total.");
    parties = [...parties, { kind: "owner" }];
    amounts.push(Number(BigInt(totalCents) - used));
  } else if (split.mode === "equal") {
    amounts = distribute(totalCents, split.parts.map(() => 1));
  } else if (split.mode === "percentage") {
    const weights = split.parts.map(part => part.basisPoints);
    if (weights.some(weight => !Number.isInteger(weight) || weight < 0 || weight > 10000)
      || weights.reduce((sum, weight) => sum + weight, 0) !== 10000) {
      throw new RangeError("Os percentuais devem somar 100%.");
    }
    amounts = distribute(totalCents, weights);
  } else {
    throw new RangeError("Modo de rateio inválido.");
  }

  return parties.map((party, index) => ({
    ...party,
    amountCents: amounts[index]!,
    installments: distribute(amounts[index]!, Array<number>(installmentCount).fill(1)),
  }));
}

function distribute(total: number, weights: number[]): number[] {
  const denominator = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const products = weights.map(weight => BigInt(total) * BigInt(weight));
  const values = products.map(product => Number(product / denominator));
  let residual = BigInt(total) - values.reduce((sum, value) => sum + BigInt(value), 0n);
  const ranked = products.map((product, index) => ({ index, remainder: product % denominator }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const { index } of ranked) {
    if (residual === 0n) break;
    values[index] = values[index]! + 1;
    residual--;
  }
  return values;
}
