import type { BillingSplit } from './split';

export type BillingType = 'once' | 'until' | 'indefinite';
export type BillingFrequency = 'monthly' | 'yearly';
export type BillingState = 'active' | 'paused' | 'ended';

export type BillingReminder = { offsetDays: number; enabled: boolean };

export const DEFAULT_BILLING_REMINDERS: BillingReminder[] = [-3, 0, 2].map((offsetDays) => ({ offsetDays, enabled: true }));

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
  endDate?: string;
  state?: BillingState;
};
