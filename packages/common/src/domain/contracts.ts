import type { UserAvatar } from './avatar';
import type { BillingKind, BillingRecurrence } from './billing';
import type { Contact } from './contacts';

export type Money = {
  amountCents: number;
  currency: 'BRL';
};

export enum Direction {
  Receivable = 'receivable',
  Payable = 'payable'
}

export enum ChargeState {
  Pending = 'pending',
  Paid = 'paid',
  Cancelled = 'cancelled'
}

export enum ProofState {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected'
}

/** What waits for review on a charge: a file, or a payment declared without one. */
export enum ProofKind {
  File = 'file',
  Declaration = 'declaration'
}

export enum SplitMode {
  Fixed = 'fixed',
  Equal = 'equal',
  Percentage = 'percentage',
  Shares = 'shares'
}

/** Who pays, as the charge plan sees it: a contact, or the owner of a conta a pagar. Not part of any payload: read `ownerPays`. */
export enum ChargePayer {
  Person = 'person',
  Owner = 'owner'
}

/**
 * Whether the owner of the billing is the one paying this charge, from the viewer's side of it: the owner of a
 * conta a pagar sees it as payable, and its payee sees it as receivable. Without `ownedByViewer` there is no
 * telling which side the viewer is on, and the answer is the old default: a contact pays.
 */
export function ownerPays(charge: { direction: Direction; ownedByViewer?: boolean }): boolean {
  if (charge.ownedByViewer === undefined) {
    return false;
  }

  return charge.ownedByViewer ? charge.direction === Direction.Payable : charge.direction === Direction.Receivable;
}

export enum SharingState {
  Ready = 'ready',
  PixRequired = 'pix_required',
  LegacyWithoutPix = 'legacy_without_pix',
  Closed = 'closed'
}

export type ChargeSummary = {
  id: string;
  description: string;
  amount: Money;
  dueDate: string;
  state: ChargeState;
  billingId: string;
  /** How the billing behind the charge repeats. */
  recurrence: BillingRecurrence;
  installment: number | null;
  installmentCount: number | null;
  /** Who is on the other side: the debtor for a receivable, the creditor for a payable. */
  counterpartName: string;
  /** Photo of the counterpart; absent or null shows the initial. */
  counterpartAvatar?: UserAvatar | null;
  /** State of the most recent proof on this charge, if any. */
  proofState: ProofState | null;
  /** True when the viewer owns the billing behind this charge; owner powers key on this, never on direction. */
  ownedByViewer?: boolean;
  /** A Pix key is attached; without one the owner marks their own bill paid straight from the feed. */
  hasPix?: boolean;
  /** The other side has an e-mail or phone on file, so a reminder can reach them; false hides "Lembrar". */
  counterpartReachable?: boolean;
  /** What is under review when `proofState` is set; null when nothing was sent. */
  proofKind?: ProofKind | null;
  /** A payment declared by the paying side waits for the other side to confirm it; false settles at once. */
  confirmationRequired?: boolean;
  /** The automatic notices of this charge are on. The API always sends it; only the creditor ever reads false. */
  notify?: boolean;
  /** The billing behind the charge: 'record' is a registro, settled on its due date, never reminded, shared or proven. Absent reads as 'live'. */
  kind?: BillingKind;
};

export enum ProofMime {
  Jpeg = 'image/jpeg',
  Png = 'image/png',
  Pdf = 'application/pdf'
}

export type ProofFile = { name: string; mime: ProofMime; size: number };

/** The single proof attached to a charge; the history of earlier ones lives in the events log. */
export type ChargeProof = {
  state: ProofState;
  kind: ProofKind;
  /** Null on a declaration: the payer said they paid without sending a file. */
  file: ProofFile | null;
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

/** What the public payment page may know: its own upload or declaration, never the charge's history. */
export type PublicProofState = {
  state: ProofState | 'uploading' | null;
  kind: ProofKind | null;
  reason: string | null;
  file: ProofFile | null;
};

/** The feed lists charges only: no billing previews, no proof or payment history rows. */
export type TimelineItem = { kind: 'charge'; direction: Direction; charge: ChargeSummary };

export type HealthResponse = {
  status: 'ok';
  service: 'receivy-api';
};

export enum PixKeyType {
  Cpf = 'cpf',
  Cnpj = 'cnpj',
  Email = 'email',
  Phone = 'phone',
  Random = 'random'
}

export type PaymentMethod = {
  id: string;
  type: 'pix';
  pixKeyType: PixKeyType;
  pixKey: string;
  label: string;
  isDefault: boolean;
  /** Block 9: the contact this key pays; null is one of the owner's own keys. */
  contactId: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type PaymentMethodInput = {
  pixKeyType: PixKeyType;
  pixKey: string;
  label?: string;
  /** Block 9: file the key under this contact of the owner; absent means the owner's own key. */
  contactId?: string;
};

export type PaymentMethodsPage = { paymentMethods: PaymentMethod[] };

/** The person on the other side of a charge, read live from their account; null user on a bill that is the owner's alone. */
export type ChargeCounterpart = {
  userId: string | null;
  name: string;
  email: string | null;
  avatar?: UserAvatar | null;
};

export type PixSnapshot = {
  keyType: PixKeyType;
  key: string;
  label: string;
};

export type ChargeDetail = ChargeSummary & {
  direction: Direction;
  recipient: ChargeCounterpart;
  /** The person on the other side of the owner: who owes, or on a conta a pagar who receives; null when the bill is the owner's alone. */
  debtorId: string | null;
  pix: PixSnapshot | null;
  sharingState: SharingState;
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
  /** Paid charges due this month on each side: the "realizado" shown beside the open totals. */
  receivedTotal: Money;
  paidTotal: Money;
};

export type TimelinePage = {
  items: TimelineItem[];
  summary: TimelineSummary;
  /** The resolved `YYYY-MM` the page was served for. Always sent by the API; absent on older fixtures. */
  month?: string;
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
