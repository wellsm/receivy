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
};

export type BillingAllocation = {
  kind: 'owner' | 'person';
  personId: string | null;
  splitMode: SplitMode;
  amount: Money;
  order: number;
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
};

export type BillingsPage = { billings: BillingSummary[]; nextCursor: string | null };
