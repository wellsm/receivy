import type { BillingCategory } from './billing-category';
import type { ChargeDetail, Money, SplitMode } from './contracts';
import type { BillingSplit } from './split';

export type BillingType = 'once' | 'until' | 'indefinite';
export type BillingFrequency = 'monthly' | 'yearly';
export type BillingState = 'active' | 'paused' | 'ended';

export type BillingReminder = { offsetDays: number; enabled: boolean };

export const DEFAULT_BILLING_REMINDERS: BillingReminder[] = [{ offsetDays: 0, enabled: true }];

export const MAX_FINITE_OCCURRENCES = 120;

export type BillingInput = {
  type: BillingType;
  frequency?: BillingFrequency;
  description?: string;
  totalCents: number;
  startDate: string;
  endDate?: string;
  timezone: string;
  paymentMethodId?: string;
  reminders?: BillingReminder[];
  split: BillingSplit;
  category?: BillingCategory;
};

export type NormalizedBillingInput = BillingInput & { description: string };

export type BillingPatch = {
  description?: string;
  totalCents?: number;
  split?: BillingSplit;
  paymentMethodId?: string;
  clearPaymentMethod?: boolean;
  reminders?: BillingReminder[];
  state?: BillingState;
  category?: BillingCategory;
};

export type BillingAllocation = {
  kind: 'owner' | 'person';
  personId: string | null;
  splitMode: SplitMode;
  amount: Money;
  order: number;
  shares?: number;
};

export type BillingPreview = {
  billingId: string;
  description: string;
  amount: Money;
  occurrenceDate: string;
  materializationDate?: string;
};

// Explicit fields: EZ4 0.52 response reflection drops Omit/intersection members.
export type BillingSummary = {
  id: string;
  type: BillingType;
  frequency?: BillingFrequency;
  description: string;
  total: Money;
  startDate: string;
  endDate?: string;
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
  type: BillingType;
  frequency?: BillingFrequency;
  description: string;
  total: Money;
  startDate: string;
  endDate?: string;
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
};

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
      type: BillingType;
      participantCount: number;
      category: BillingCategory;
    };

export type InviteAcceptResult = {
  billingId: string;
  chargeId: string | null;
  joinedSplit: boolean;
};
