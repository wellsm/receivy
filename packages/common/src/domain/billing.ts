import type { UserAvatar } from './avatar';
import type { BillingCategory } from './billing-category';
import type { ChargeDetail, Direction, Money, PixKeyType, PixSnapshot, SplitMode } from './contracts';
import type { BillingSplit } from './split';

export const enum BillingRecurrence {
  Once = 'once',
  Until = 'until',
  Indefinite = 'indefinite'
}

export const enum BillingFrequency {
  Monthly = 'monthly',
  Yearly = 'yearly'
}

/** `live` reminds, shares and takes proofs; `record` is a registro: settled on its due date, nobody hears about it. */
export const enum BillingKind {
  Live = 'live',
  Record = 'record'
}

export const enum BillingState {
  Active = 'active',
  Paused = 'paused',
  Ended = 'ended'
}

/** 'fixed' repeats the start day (clamped to short months); 'end_of_month' always lands on the last day. */
export const enum BillingDueRule {
  Fixed = 'fixed',
  EndOfMonth = 'end_of_month'
}

export const enum SplitPartKind {
  Owner = 'owner',
  User = 'user'
}

/** What Pausar/Encerrar do with pending charges: keep this month's, or cancel every pending one. */
export const enum PendingChargesAction {
  Keep = 'keep',
  Cancel = 'cancel'
}

/** Whether an edit of a recorrente also rewrites this month's charges that are not due yet. */
export const enum EditScope {
  CurrentMonth = 'current_month',
  NextMonth = 'next_month'
}

export type BillingReminder = { offsetDays: number; enabled: boolean };

/** A Pix key typed on a conta a pagar: it belongs to whoever receives, never to a wallet. */
export type BillingPixInput = { keyType: PixKeyType; key: string; label?: string };

export type BillingPayee = { userId: string; name: string; avatar?: UserAvatar | null };

export const DEFAULT_BILLING_REMINDERS: BillingReminder[] = [{ offsetDays: 0, enabled: true }];

export const MAX_FINITE_OCCURRENCES = 120;

export type BillingInput = {
  recurrence: BillingRecurrence;
  frequency?: BillingFrequency;
  description?: string;
  totalCents: number;
  startDate: string;
  endDate?: string;
  /** 'end_of_month' lands every occurrence on the last day of its month (monthly or once). Absent means 'fixed'. */
  dueRule?: BillingDueRule;
  timezone: string;
  paymentMethodId?: string;
  reminders?: BillingReminder[];
  /** Required for a conta a receber; a conta a pagar has no participants and may omit it. */
  split?: BillingSplit;
  category?: BillingCategory;
  /** Block 9: who receives (a contact of the owner). Absent means the owner receives. */
  contactId?: string;
  /** Conta a pagar only: the key of the receiving contact, filed under it as a payment method. */
  pix?: BillingPixInput;
  /** 'record' is a registro: the owner already received or paid it, every charge settles on its due date and nobody is notified. */
  kind?: BillingKind;
};

export type NormalizedBillingInput = BillingInput & { description: string; split: BillingSplit; type: Direction };

export type BillingPatch = {
  description?: string;
  totalCents?: number;
  split?: BillingSplit;
  paymentMethodId?: string;
  clearPaymentMethod?: boolean;
  pix?: BillingPixInput;
  /** Block 9: who receives (a contact of the owner), replacing the current one. */
  contactId?: string;
  /** Recorrente only: the next due date; occurrences already generated keep theirs. */
  startDate?: string;
  /** Recorrente only, sent with startDate: a fixed day or the last day of each month. */
  dueRule?: BillingDueRule;
  reminders?: BillingReminder[];
  state?: BillingState;
  /** Only with state paused/ended. Absent keeps the old behavior: pausing keeps, ending cancels. */
  pendingCharges?: PendingChargesAction;
  /** Recorrente only. Absent means next month. */
  applyTo?: EditScope;
  category?: BillingCategory;
  /** Never changes after creation: a value other than the stored one answers 409 SETTLED_LOCKED. */
  kind?: BillingKind;
};

/** Who receives a conta a pagar, as the owner knows them. */
export type BillingContact = { id: string; userId: string; name: string; avatar: UserAvatar | null };

export type BillingAllocation = {
  kind: SplitPartKind;
  userId: string | null;
  splitMode: SplitMode;
  amount: Money;
  order: number;
  /** The participant's automatic notices: the value new charges of theirs start with. Always true on the owner part. */
  notify: boolean;
  shares?: number;
};

export type BillingPreview = {
  billingId: string;
  type: Direction;
  description: string;
  amount: Money;
  occurrenceDate: string;
  materializationDate?: string;
};

// Explicit fields: EZ4 0.52 response reflection drops Omit/intersection members.
export type BillingSummary = {
  id: string;
  recurrence: BillingRecurrence;
  type: Direction;
  /** Block 9: who receives a conta a pagar, or null when the bill is the owner's alone. */
  contact: BillingContact | null;
  /** @deprecated Block 9: read contact instead. Conta a pagar: who receives, or null when the bill is the owner's alone. */
  payeeName: string | null;
  /** 'record' is a registro: the owner alone, already settled. The API always sends it; absent reads as 'live'. */
  kind?: BillingKind;
  /** @deprecated Block 9: read contact instead. Registro only: the counterpart typed by the owner; null on every other conta. */
  counterpartLabel?: string | null;
  frequency?: BillingFrequency;
  description: string;
  total: Money;
  startDate: string;
  endDate?: string;
  /** Always sent by the API; absent on older payloads, read as 'fixed'. */
  dueRule?: BillingDueRule;
  state: BillingState;
  installmentCount?: number;
  nextDueDate: string | null;
  createdAt: string;
  category: BillingCategory;
  participantCount: number;
  chargeCount: number;
  paidCount: number;
  /** Proofs awaiting review on the billing's charges. */
  proofsPending: number;
  /** The single pending charge when there is exactly one participant; null otherwise. */
  shareChargeId: string | null;
};

export type BillingDetail = {
  id: string;
  recurrence: BillingRecurrence;
  type: Direction;
  /** Block 9: who receives a conta a pagar, or null when the bill is the owner's alone. */
  contact: BillingContact | null;
  /** @deprecated Block 9: read contact instead. */
  payee: BillingPayee | null;
  /** 'record' is a registro: the owner alone, already settled. The API always sends it; absent reads as 'live'. */
  kind?: BillingKind;
  /** @deprecated Block 9: read contact instead. Registro only: the counterpart typed by the owner; null on every other conta. */
  counterpartLabel?: string | null;
  /** Inline key of a conta a pagar; null on a conta a receber, which uses paymentMethodId. */
  pix: PixSnapshot | null;
  frequency?: BillingFrequency;
  description: string;
  total: Money;
  startDate: string;
  endDate?: string;
  /** Always sent by the API; absent on older payloads, read as 'fixed'. */
  dueRule?: BillingDueRule;
  state: BillingState;
  installmentCount?: number;
  nextDueDate: string | null;
  createdAt: string;
  updatedAt: string;
  timezone: string;
  paymentMethodId?: string;
  reminders: BillingReminder[];
  split: BillingSplit;
  allocations: BillingAllocation[];
  charges: ChargeDetail[];
  previews: BillingPreview[];
  nextMaterialization: string | null;
  category: BillingCategory;
  invite: BillingInvite | null;
  /** People who joined by invite and wait for the owner to say who they are; empty for everyone but the owner. */
  guests: BillingGuest[];
  /** Owner's contacts without an e-mail: the only ones a guest can be linked to. */
  linkableContacts: LinkableContact[];
};

export type BillingGuest = { id: string; userId: string; name: string; email: string; createdAt: string; avatar?: UserAvatar | null };

export type LinkableContact = { contactId: string; displayName: string; avatar?: UserAvatar | null };

/** What the owner decides about a waiting guest. */
export type BillingGuestAction = { action: 'link'; contactId: string } | { action: 'add' } | { action: 'dismiss' };

export type BillingsPage = { billings: BillingSummary[]; nextCursor: string | null };

export type BillingInvite = { url: string; expiresAt: string };

/** An unusable invite answers with the flag alone; the billing headline stays private. */
export type PublicInviteView =
  | { expired: true }
  | {
      expired: false;
      creditorFirstName: string;
      description: string;
      amount: Money;
      recurrence: BillingRecurrence;
      participantCount: number;
      category: BillingCategory;
    };

export type InviteAcceptResult = {
  billingId: string;
  chargeId: string | null;
  joinedSplit: boolean;
  /** The split already names contacts without e-mail: the owner decides whether the guest is one of them. */
  awaitingOwner: boolean;
};
