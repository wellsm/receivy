import {
  BillingDueRule,
  BillingFrequency,
  BillingKind,
  type BillingInput,
  type BillingReminder,
  BillingRecurrence,
  MAX_FINITE_OCCURRENCES,
  SplitPartKind
} from './billing';
import { billingDates, normalizeBillingInput } from './billing-calendar';
import { BillingCategory } from './billing-category';
import { Direction, SplitMode } from './contracts';
import { parseBRLCents, parsePercentageBasisPoints } from './financial-form';
import type { SplitParty } from './split';

export type ReminderDraft = Omit<BillingReminder, 'offsetDays'> & { offsetDays: string };

/** Raw text split values, kept separate per mode so switching modes never loses what was typed. */
export type SplitValues = {
  /** `fixed`: amount text per person id. */
  fixed: Record<string, string>;
  /** `percentage`: percentage text per person id or `owner`. */
  percentage: Record<string, string>;
  /** `shares`: share count text per person id or `owner`. */
  shares: Record<string, string>;
};

/** Fresh split values for a new draft. Returns a new object on every call. */
export function EMPTY_SPLIT_VALUES(): SplitValues {
  return { fixed: {}, percentage: {}, shares: {} };
}

export type BillingDraft = {
  /** 'receivable' collects from contacts; 'payable' is the owner's own bill, optionally owed to one contact. */
  direction: Direction;
  /** Conta a pagar: the contact who receives (contacts.id). Empty only while the seat is still being picked. */
  payee: string;
  type: BillingRecurrence;
  selected: string[];
  owner: boolean;
  amount: string;
  description: string;
  frequency: BillingFrequency;
  start: string;
  /** 'end_of_month' keeps `start` on the last day of the picked month; ignored once the draft is yearly. */
  dueRule: BillingDueRule;
  end: string;
  /** "N vezes" shortcut for `until`: computes `end` when `end` is empty. */
  occurrences: string;
  timezone: string;
  pix: string;
  mode: SplitMode;
  /** Raw text split values, one bucket per mode; `equal` reads none of them. */
  values: SplitValues;
  category: BillingCategory;
  reminders: ReminderDraft[];
  /** Automatic notices per participant user id. A participant without a key sends nothing, so the API keeps what it stores. */
  notify?: Record<string, boolean>;
  /** "Já recebi" / "Já paguei": the draft is a registro. Absent on drafts stored before registros existed. */
  settled?: boolean;
};

/** Fresh draft for a new billing form. Returns a new object on every call. */
export function EMPTY_BILLING_DRAFT(timezone: string, today: string): BillingDraft {
  return {
    direction: Direction.Receivable,
    payee: '',
    type: BillingRecurrence.Once,
    selected: [],
    owner: true,
    amount: '',
    description: '',
    frequency: BillingFrequency.Monthly,
    start: today,
    dueRule: BillingDueRule.Fixed,
    end: '',
    occurrences: '',
    timezone,
    pix: '',
    mode: SplitMode.Equal,
    values: EMPTY_SPLIT_VALUES(),
    category: BillingCategory.Other,
    reminders: [{ offsetDays: '0', enabled: true }]
  };
}

function integer(value: string, message: string): number {
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new RangeError(message);
  }

  return Number(value);
}

/** Month ends exist for a single due date and for monthly rules; a yearly draft keeps a fixed day. */
function dueRuleFor(draft: BillingDraft): BillingDueRule | undefined {
  if (draft.dueRule !== BillingDueRule.EndOfMonth) {
    return undefined;
  }

  return draft.type === BillingRecurrence.Once || draft.frequency === BillingFrequency.Monthly ? BillingDueRule.EndOfMonth : undefined;
}

function endDateFor(draft: BillingDraft): string | undefined {
  if (draft.type !== BillingRecurrence.Until) {
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

  const dates = billingDates(
    { frequency: draft.frequency, startDate: draft.start, dueRule: dueRuleFor(draft) },
    draft.start,
    '9999-12-31',
    count
  );

  return dates.at(-1);
}

/** Due dates a `until` draft produces for `endDate`, reusing the same calendar rule `endDateFor` computed it from. */
function installmentCountFor(draft: BillingDraft, endDate: string | undefined): number {
  if (!endDate) {
    throw new RangeError('Informe a data final ou quantas vezes cobrar.');
  }

  return billingDates(
    { frequency: draft.frequency, startDate: draft.start, dueRule: dueRuleFor(draft) },
    draft.start,
    endDate,
    MAX_FINITE_OCCURRENCES + 1
  ).length;
}

export type UntilInstallmentPreview = {
  /** Number of due dates the parcelado produces. */
  count: number;
  /** The typed total, ceiling-split across `count`. What each due date is actually charged. */
  perInstallmentCents: number;
  /** `perInstallmentCents * count`: may exceed the typed total once rounded up. */
  totalCents: number;
  /** Whether rounding up made `totalCents` differ from the typed amount. */
  roundedUp: boolean;
};

/**
 * Live preview of a parcelado's per-installment amount, for the form to show "Nx de R$ …" beside the
 * typed total. Tolerant like `previewBillingSplit`: null while the draft cannot price one yet, never throws.
 */
export function untilInstallmentPreview(draft: BillingDraft): UntilInstallmentPreview | null {
  if (draft.type !== BillingRecurrence.Until) {
    return null;
  }

  let typedCents: number;

  try {
    typedCents = parseBRLCents(draft.amount);
  } catch {
    return null;
  }

  if (typedCents <= 0) {
    return null;
  }

  let count: number;

  try {
    count = installmentCountFor(draft, endDateFor(draft));
  } catch {
    return null;
  }

  const perInstallmentCents = Math.ceil(typedCents / count);

  return { count, perInstallmentCents, totalCents: perInstallmentCents * count, roundedUp: perInstallmentCents * count !== typedCents };
}

/** The switch travels only when the draft holds it for that participant. */
function notifyOf(draft: BillingDraft, userId: string): { notify?: boolean } {
  const value = draft.notify?.[userId];

  if (value === undefined) {
    return {};
  }

  return { notify: value };
}

function buildSplit(draft: BillingDraft, parties: SplitParty[]): BillingInput['split'] {
  if (draft.mode === SplitMode.Equal) {
    return { mode: draft.mode, parts: parties };
  }

  if (draft.mode === SplitMode.Fixed) {
    const values = draft.values.fixed;

    return {
      mode: draft.mode,
      parts: draft.selected.map((userId) => ({
        kind: SplitPartKind.User,
        userId,
        ...notifyOf(draft, userId),
        amountCents: parseBRLCents(values[userId] ?? '')
      }))
    };
  }

  if (draft.mode === SplitMode.Shares) {
    const values = draft.values.shares;

    return {
      mode: draft.mode,
      parts: parties.map((party) => ({
        ...party,
        shares: integer(values[party.kind === SplitPartKind.Owner ? 'owner' : party.userId] || '1', 'Informe cotas inteiras de 1 a 1000.')
      }))
    };
  }

  const values = draft.values.percentage;

  return {
    mode: draft.mode,
    parts: parties.map((party) => ({
      ...party,
      basisPoints: parsePercentageBasisPoints(values[party.kind === SplitPartKind.Owner ? 'owner' : party.userId] ?? '')
    }))
  };
}

/** Who is on the other side of a registro: the contact who receives it, or the single person who paid the owner. */
function counterpartOf(draft: BillingDraft): Pick<BillingInput, 'contactId' | 'split'> {
  if (draft.direction === Direction.Payable) {
    return { contactId: payeeOf(draft) };
  }

  // A registro a receber has one payer, and the seat asks for them by name: the split message would not fit.
  if (!draft.selected.length) {
    throw new RangeError('Escolha quem pagou.');
  }

  return { split: { mode: SplitMode.Equal, parts: draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId })) } };
}

/** A conta a pagar always names who receives it: the key it carries is filed under that contact. */
function payeeOf(draft: BillingDraft): string {
  if (!draft.payee) {
    throw new RangeError('Escolha quem recebe.');
  }

  return draft.payee;
}

/** Shared pure review boundary; raw text stays in each platform's local UI. `now` is passed only on creation. */
export function buildBillingInput(draft: BillingDraft, now?: Date): BillingInput {
  const endDate = endDateFor(draft);
  const typedCents = parseBRLCents(draft.amount);
  // Parcelado: the typed amount is the total, ceiling-split across its due dates; the API still stores
  // totalCents per occurrence, so every other type sends the typed amount unchanged.
  const totalCents = draft.type === BillingRecurrence.Until ? Math.ceil(typedCents / installmentCountFor(draft, endDate)) : typedCents;

  const schedule = {
    recurrence: draft.type,
    frequency: draft.type === BillingRecurrence.Once ? undefined : draft.frequency,
    description: draft.description,
    totalCents,
    startDate: draft.start,
    endDate,
    dueRule: dueRuleFor(draft),
    category: draft.category,
    timezone: draft.timezone
  };

  // A registro names who is on the other side and has nobody to pay through or remind.
  if (draft.settled) {
    return normalizeBillingInput({ ...schedule, kind: BillingKind.Record, ...counterpartOf(draft) }, now);
  }

  const base = {
    ...schedule,
    reminders: draft.reminders.map((reminder) => ({
      enabled: reminder.enabled,
      offsetDays: integer(reminder.offsetDays, 'Informe dias inteiros, como -3, 0 ou 2.')
    }))
  };

  if (draft.direction === Direction.Payable) {
    // Whoever receives owns the key: the draft points at one of their payment methods, or at none.
    return normalizeBillingInput({ ...base, contactId: payeeOf(draft), paymentMethodId: draft.pix || undefined }, now);
  }

  if (!draft.selected.length) {
    throw new RangeError('Selecione ao menos um contato.');
  }

  const parties = [
    ...draft.selected.map((userId) => ({ kind: SplitPartKind.User, userId, ...notifyOf(draft, userId) }) satisfies SplitParty),
    ...(draft.owner ? [{ kind: SplitPartKind.Owner } satisfies SplitParty] : [])
  ];

  return normalizeBillingInput(
    {
      ...base,
      paymentMethodId: draft.pix || undefined,
      split: buildSplit(draft, parties)
    },
    now
  );
}
