import type { BillingPreview, BillingType } from './billing';
import type { Contact } from './contacts';

export type Money = {
  amountCents: number;
  currency: 'BRL';
};

export type Direction = 'receivable' | 'payable';
export type ChargeState = 'pending' | 'paid' | 'cancelled';
export type ProofState = 'pending' | 'accepted' | 'rejected';
export type SplitMode = 'fixed' | 'equal' | 'percentage' | 'shares';

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
  /** Who is on the other side: the debtor for a receivable, the creditor for a payable. */
  counterpartName: string;
  /** State of the most recent proof on this charge, if any. */
  proofState: ProofState | null;
  /** Who pays: a contact (default) or the billing owner on a conta a pagar. Omitted by older payloads means 'person'. */
  payer?: 'person' | 'owner';
  /** True when the viewer owns the billing behind this charge; owner powers key on this, never on direction. */
  ownedByViewer?: boolean;
  /** A Pix key is attached; the feed offers "Pagar via Pix" only then. */
  hasPix?: boolean;
  /** The other side has an e-mail or phone on file, so a reminder can reach them; false hides "Lembrar". */
  counterpartReachable?: boolean;
};

export type ProofMime = 'image/jpeg' | 'image/png' | 'application/pdf';

export type ProofFile = { name: string; mime: ProofMime; size: number };

/** The single file attached to a charge; the history of earlier ones lives in the events log. */
export type ChargeProof = {
  state: ProofState;
  file: ProofFile;
  sentAt: string;
  reviewedAt: string | null;
  /** The creditor's words when rejecting. */
  reason: string | null;
  /** True when the viewer is the one who sent it, which is what allows taking it back. */
  sentByViewer: boolean;
};

export type ProofUploadInput = { filename: string; mime: ProofMime; size: number };

/** A signed PUT the client uses directly against the bucket; the API learns about the file from the bucket event. */
export type ProofUploadTicket = { uploadUrl: string; expiresAt: string };

/** What the public payment page may know: its own upload, never the charge's history. */
export type PublicProofState = { state: ProofState | 'uploading' | null; reason: string | null; file: ProofFile | null };

export type ProofSummary = { chargeId: string; state: ProofState; sentAt: string };

export type PaymentSummary = { chargeId: string; amount: Money; paidAt: string };

export type TimelineItem =
  | { kind: 'charge'; direction: Direction; charge: ChargeSummary }
  | { kind: 'proof'; direction: Direction; proof: ProofSummary }
  | { kind: 'payment'; direction: Direction; payment: PaymentSummary }
  | { kind: 'billing_preview'; direction: Direction; preview: BillingPreview };

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

/** The person on the other side of a charge, read live from their account; null user on a bill that is the owner's alone. */
export type ChargeCounterpart = {
  userId: string | null;
  name: string;
  email: string | null;
};

export type PixSnapshot = {
  keyType: PixKeyType;
  key: string;
  label: string;
};

export type ChargeDetail = ChargeSummary & {
  direction: Direction;
  recipient: ChargeCounterpart;
  /** The person who owes (or, on a conta a pagar, who receives); null when the bill is the owner's alone. */
  debtorUserId: string | null;
  pix: PixSnapshot | null;
  sharingState: 'ready' | 'pix_required' | 'legacy_without_pix' | 'closed';
  proof: ChargeProof | null;
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
  receivableCount: number;
  payableCount: number;
};

export type TimelinePage = {
  items: TimelineItem[];
  summary: TimelineSummary;
  nextCursor: string | null;
};

export type ContactLedger = {
  contactId: string;
  contact: Contact;
  balance: Money;
  receivable: Money;
  payable: Money;
  charges: ChargeDetail[];
  nextCursor: string | null;
};
