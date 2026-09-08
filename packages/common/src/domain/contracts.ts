import type { BillingType } from './billing';
import type { Person } from './people';

export type Money = {
  amountCents: number;
  currency: 'BRL';
};

export type Direction = 'receivable' | 'payable';
export type ChargeState = 'pending' | 'paid' | 'cancelled';
export type ProofState = 'pending' | 'accepted' | 'rejected';
export type SplitMode = 'fixed' | 'equal' | 'percentage';

export type ChargeSummary = {
  id: string;
  description: string;
  amount: Money;
  dueDate: string;
  state: ChargeState;
  billingId: string;
  billingType: BillingType;
  installment: number | null;
  installmentCount: number | null;
};

export type ProofSummary = {
  id: string;
  chargeId: string;
  state: ProofState;
  createdAt: string;
};

export type ProofDetail = ProofSummary & {
  originalName: string;
  mime: 'image/jpeg' | 'image/png' | 'application/pdf';
  size: number;
  reason: string | null;
  closureReason: 'paid' | 'cancelled' | null;
  reviewedAt: string | null;
};
export type ProofUploadInput = { filename: string; mime: 'image/jpeg' | 'image/png' | 'application/pdf'; size: number };
export type ProofUploadIntent = { id: string; uploadUrl: string; expiresAt: string };

export type PaymentSummary = {
  id: string;
  chargeId: string;
  amount: Money;
  paidAt: string;
};

export type TimelineItem =
  | { kind: 'charge'; direction: Direction; charge: ChargeSummary }
  | { kind: 'proof'; direction: Direction; proof: ProofSummary }
  | { kind: 'payment'; direction: Direction; payment: PaymentSummary }
  | { kind: 'billing_preview'; direction: 'receivable'; preview: import('./billing').BillingPreview };

export type HealthResponse = {
  status: 'ok';
  service: 'receivy-api';
};

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export type PaymentMethod = {
  id: string;
  type: 'pix';
  pixKeyType: PixKeyType;
  pixKey: string;
  label: string;
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
};

export type PaymentMethodInput = {
  pixKeyType: PixKeyType;
  pixKey: string;
  label?: string;
};

export type PaymentMethodsPage = { paymentMethods: PaymentMethod[] };

export type ChargeRecipientSnapshot = {
  name: string;
  email: string | null;
};

export type PixSnapshot = {
  keyType: PixKeyType;
  key: string;
  label: string;
};

export type PaymentRecord = {
  id: string;
  chargeId: string;
  amount: Money;
  method: 'pix' | 'cash' | 'transfer' | 'other';
  paidAt: string;
  createdAt: string;
};

export type ChargeDetail = ChargeSummary & {
  direction: Direction;
  recipient: ChargeRecipientSnapshot;
  pix: PixSnapshot | null;
  sharingState: 'ready' | 'pix_required' | 'legacy_without_pix' | 'closed';
  payment: PaymentRecord | null;
  cancelledAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type PublicLink = { token: string; expiresAt: string };

export type PublicChargeView = {
  creditorFirstName: string;
  description: string;
  amount: Money;
  dueDate: string;
  state: ChargeState;
  pix: PixSnapshot | null;
  uploadsEnabled: boolean;
};

export type TimelineSummary = {
  receivable: Money;
  payable: Money;
  overdue: Money;
  pending: Money;
  proofsToReview: number;
};

export type TimelinePage = {
  items: TimelineItem[];
  summary: TimelineSummary;
  nextCursor: string | null;
};

export type PersonLedger = {
  personId: string;
  person: Person;
  balance: Money;
  receivable: Money;
  payable: Money;
  charges: ChargeDetail[];
  nextCursor: string | null;
};
