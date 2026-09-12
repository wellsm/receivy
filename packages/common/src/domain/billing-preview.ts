import type { BillingDraft } from './billing-draft';
import { parseBRLCents, parsePercentageBasisPoints } from './financial-form';
import { formatMoney } from './money';
import { type BillingSplit, resolveBillingSplit, type SplitParty } from './split';

export type BillingSplitPreview = {
  /** Amount in cents per party, keyed by `splitPartyKey`. Empty while the screen cannot be priced. */
  amounts: Record<string, number>;
  /** What is missing for the split to close, or `null` while it already adds up. */
  error: string | null;
};

/** Stable key for a party: the contact id, or `owner` for the account holder. */
export function splitPartyKey(party: SplitParty): string {
  return party.kind === 'owner' ? 'owner' : party.userId;
}

/** Everyone who takes part in the draft: the selected contacts, then the owner. */
export function splitParties(draft: BillingDraft): SplitParty[] {
  return [...draft.selected.map((userId) => ({ kind: 'user' as const, userId })), ...(draft.owner ? [{ kind: 'owner' as const }] : [])];
}

/**
 * Mirrors `buildBillingInput`'s split for the live preview only: the form has to
 * price a half-typed screen, where the shared builder is allowed to throw.
 */
function previewSplit(draft: BillingDraft): BillingSplit {
  const parties = splitParties(draft);

  if (draft.mode === 'fixed') {
    const values = draft.values.fixed;

    return {
      mode: 'fixed',
      parts: draft.selected.map((userId) => ({
        kind: 'user',
        userId,
        amountCents: parseBRLCents(values[userId] ?? '')
      }))
    };
  }

  if (draft.mode === 'shares') {
    const values = draft.values.shares;

    return { mode: 'shares', parts: parties.map((party) => ({ ...party, shares: Number(values[splitPartyKey(party)] || '1') })) };
  }

  if (draft.mode === 'percentage') {
    const values = draft.values.percentage;

    return {
      mode: 'percentage',
      parts: parties.map((party) => ({ ...party, basisPoints: parsePercentageBasisPoints(values[splitPartyKey(party)] ?? '') }))
    };
  }

  return { mode: 'equal', parts: parties };
}

function remainderHint(draft: BillingDraft, totalCents: number): string {
  if (draft.mode === 'percentage') {
    try {
      const values = draft.values.percentage;
      const sum = splitParties(draft).reduce((total, party) => total + parsePercentageBasisPoints(values[splitPartyKey(party)] ?? ''), 0);

      return sum === 10_000 ? '' : `Soma ${(sum / 100).toLocaleString('pt-BR')}%`;
    } catch {
      return '';
    }
  }

  if (draft.mode === 'fixed') {
    // When the owner takes part, the remainder is already the owner's share: no hint to close it.
    if (draft.owner) {
      return '';
    }

    try {
      const values = draft.values.fixed;
      const used = draft.selected.reduce((total, userId) => total + parseBRLCents(values[userId] ?? ''), 0);

      return used < totalCents ? `Faltam ${formatMoney({ amountCents: totalCents - used, currency: 'BRL' })}` : '';
    } catch {
      return '';
    }
  }

  return '';
}

/** The typed amount in cents, or zero while it is still being typed. */
export function draftTotalCents(draft: BillingDraft): number {
  try {
    return parseBRLCents(draft.amount);
  } catch {
    return 0;
  }
}

/** Tolerant live preview of a draft's split: never throws, so the form can price every keystroke. */
export function previewBillingSplit(draft: BillingDraft): BillingSplitPreview {
  let totalCents: number;

  try {
    totalCents = parseBRLCents(draft.amount);
  } catch {
    return { amounts: {}, error: null };
  }

  const amounts: Record<string, number> = {};
  let error: string | null = null;

  try {
    for (const allocation of resolveBillingSplit(totalCents, previewSplit(draft))) {
      amounts[splitPartyKey(allocation)] = allocation.amountCents;
    }
  } catch (reason) {
    error = reason instanceof RangeError ? reason.message : null;
  }

  return { amounts, error: remainderHint(draft, totalCents) || error };
}
