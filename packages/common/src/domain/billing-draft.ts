import type { BillingFrequency, BillingInput, BillingReminder, BillingType } from './billing';
import { billingDates, normalizeBillingInput } from './billing-calendar';
import type { BillingCategory } from './billing-category';
import type { SplitMode } from './contracts';
import { parseBRLCents, parsePercentageBasisPoints } from './financial-form';

export type ReminderDraft = Omit<BillingReminder, 'offsetDays'> & { offsetDays: string };

export type BillingDraft = {
  type: BillingType;
  selected: string[];
  owner: boolean;
  amount: string;
  description: string;
  frequency: BillingFrequency;
  start: string;
  end: string;
  /** "N vezes" shortcut for `until`: computes `end` when `end` is empty. */
  occurrences: string;
  timezone: string;
  pix: string;
  mode: SplitMode;
  /** For `fixed`/`percentage`, the raw text amount per key; for `shares`, the raw text share count per key. */
  values: Record<string, string>;
  category: BillingCategory;
  reminders: ReminderDraft[];
};

/** Fresh draft for a new billing form. Returns a new object on every call. */
export function EMPTY_BILLING_DRAFT(timezone: string, today: string): BillingDraft {
  return {
    type: 'once',
    selected: [],
    owner: true,
    amount: '',
    description: '',
    frequency: 'monthly',
    start: today,
    end: '',
    occurrences: '',
    timezone,
    pix: '',
    mode: 'equal',
    values: {},
    category: 'other',
    reminders: [{ offsetDays: '0', enabled: true }]
  };
}

function integer(value: string, message: string): number {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new RangeError(message);
  }

  return Number(value);
}

function endDateFor(draft: BillingDraft): string | undefined {
  if (draft.type !== 'until') {
    return undefined;
  }

  if (draft.end) {
    return draft.end;
  }

  if (!draft.occurrences) {
    throw new RangeError('Informe a data final ou quantas vezes cobrar.');
  }

  const count = integer(draft.occurrences, 'Informe quantas vezes cobrar, como 3 ou 12.');

  if (count < 1) {
    throw new RangeError('Informe quantas vezes cobrar, como 3 ou 12.');
  }

  const dates = billingDates({ frequency: draft.frequency, startDate: draft.start }, draft.start, '9999-12-31', count);

  return dates.at(-1);
}

function buildSplit(draft: BillingDraft, parties: ({ kind: 'owner' } | { kind: 'person'; personId: string })[]): BillingInput['split'] {
  if (draft.mode === 'equal') {
    return { mode: draft.mode, parts: parties };
  }

  if (draft.mode === 'fixed') {
    return {
      mode: draft.mode,
      parts: draft.selected.map((personId) => ({
        kind: 'person' as const,
        personId,
        amountCents: parseBRLCents(draft.values[personId] ?? '')
      }))
    };
  }

  if (draft.mode === 'shares') {
    return {
      mode: draft.mode,
      parts: parties.map((party) => ({
        ...party,
        shares: integer(draft.values[party.kind === 'owner' ? 'owner' : party.personId] || '1', 'Informe cotas inteiras de 1 a 1000.')
      }))
    };
  }

  return {
    mode: draft.mode,
    parts: parties.map((party) => ({
      ...party,
      basisPoints: parsePercentageBasisPoints(draft.values[party.kind === 'owner' ? 'owner' : party.personId] ?? '')
    }))
  };
}

/** Shared pure review boundary; raw text stays in each platform's local UI. */
export function buildBillingInput(draft: BillingDraft): BillingInput {
  if (!draft.selected.length) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  const parties = [
    ...draft.selected.map((personId) => ({ kind: 'person' as const, personId })),
    ...(draft.owner ? [{ kind: 'owner' as const }] : [])
  ];

  const split = buildSplit(draft, parties);

  return normalizeBillingInput({
    type: draft.type,
    frequency: draft.type === 'once' ? undefined : draft.frequency,
    description: draft.description,
    totalCents: parseBRLCents(draft.amount),
    startDate: draft.start,
    endDate: endDateFor(draft),
    category: draft.category,
    timezone: draft.timezone,
    paymentMethodId: draft.pix || undefined,
    reminders: draft.reminders.map((reminder) => ({
      enabled: reminder.enabled,
      offsetDays: integer(reminder.offsetDays, 'Informe dias inteiros, como -3, 0 ou 2.')
    })),
    split
  });
}
