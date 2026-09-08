import type { BillingFrequency, BillingInput, BillingReminder, BillingType } from './billing';
import { billingDates, normalizeBillingInput } from './billing-calendar';
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
  values: Record<string, string>;
  reminders: ReminderDraft[];
};

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

/** Shared pure review boundary; raw text stays in each platform's local UI. */
export function buildBillingInput(draft: BillingDraft): BillingInput {
  if (!draft.selected.length) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  const parties = [
    ...draft.selected.map((personId) => ({ kind: 'person' as const, personId })),
    ...(draft.owner ? [{ kind: 'owner' as const }] : [])
  ];

  const split =
    draft.mode === 'equal'
      ? { mode: draft.mode, parts: parties }
      : draft.mode === 'fixed'
        ? {
            mode: draft.mode,
            parts: draft.selected.map((personId) => ({
              kind: 'person' as const,
              personId,
              amountCents: parseBRLCents(draft.values[personId] ?? '')
            }))
          }
        : {
            mode: draft.mode,
            parts: parties.map((party) => ({
              ...party,
              basisPoints: parsePercentageBasisPoints(draft.values[party.kind === 'owner' ? 'owner' : party.personId] ?? '')
            }))
          };

  return normalizeBillingInput({
    type: draft.type,
    frequency: draft.type === 'once' ? undefined : draft.frequency,
    description: draft.description,
    totalCents: parseBRLCents(draft.amount),
    startDate: draft.start,
    endDate: endDateFor(draft),
    timezone: draft.timezone,
    paymentMethodId: draft.pix || undefined,
    reminders: draft.reminders.map((reminder) => ({
      enabled: reminder.enabled,
      offsetDays: integer(reminder.offsetDays, 'Informe dias inteiros, como -3, 0 ou 2.')
    })),
    split
  });
}
