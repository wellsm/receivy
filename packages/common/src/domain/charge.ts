import type { BillingKind, BillingRecurrence } from './billing';
import { type ChargeSummary, ChargeState, Direction, type Money, type ProofKind, type ProofState } from './contracts';

/** One charge of the month as `GET /charges` answers it: the row plus what its joins say, nothing read per row. */
export type ListChargeItem = {
  id: string;
  billingId: string;
  description: string;
  installment?: number;
  installmentCount?: number;
  state: ChargeState;
  dueDate: string;
  amountCents: number;
  /** The viewer's side, like `BillingSummary.type`: whoever sits on the creditor side collects, anyone else pays. */
  type: Direction;
  /** The viewer owns the billing behind the charge; owner powers key on this, never on direction. */
  ownedByViewer: boolean;
  /** A Pix key was frozen on the charge when it was published. */
  hasPayment: boolean;
  /** The automatic notices of this charge are on; only the creditor ever reads false. */
  notify: boolean;
  /** The other side has an e-mail or phone on file, so a reminder can reach them. */
  counterpartReachable: boolean;
  /** A payment declared by the paying side waits for the other side to confirm it; false settles at once. */
  confirmationRequired: boolean;
  proof: {
    state: ProofState;
    kind: ProofKind;
  } | null;
  billing: {
    recurrence: BillingRecurrence;
    kind: BillingKind;
    /** The owner's agenda entry for the person who receives; null unless the viewer owns a conta a pagar. */
    contact: {
      id: string;
      nickname?: string | null;
      user: {
        name?: string | null;
      };
    } | null;
  };
  creditor?: {
    name?: string | null;
  };
  debtor?: {
    name?: string | null;
  };
};

export type ListCharge = ListChargeItem[];

export type DirectionTotals = {
  /** Still open: charges nobody settled yet. */
  pending: Money;
  /** How many open charges make up `pending`; settled ones are not counted. */
  count: number;
  /** Already settled this month. */
  paid: Money;
};

export type ChargeTotals = {
  receivable: DirectionTotals;
  payable: DirectionTotals;
};

/** Who is on the other side, as the viewer knows them: the contact's nickname first, then the person's name. */
export function counterpartName(charge: ListChargeItem): string {
  if (charge.type === Direction.Payable) {
    const contact = charge.billing.contact;

    return contact?.nickname || contact?.user.name || charge.creditor?.name || 'Você';
  }

  return charge.debtor?.name || 'Você';
}

function money(amountCents: number): Money {
  return { amountCents, currency: 'BRL' };
}

/** The list item in the shape the card helpers (`chargeBadges`, `chargeAction`, `chargeStateLabel`) read. */
export function chargeSummaryOf(charge: ListChargeItem): ChargeSummary {
  return {
    id: charge.id,
    description: charge.description,
    amount: money(charge.amountCents),
    dueDate: charge.dueDate,
    state: charge.state,
    billingId: charge.billingId,
    recurrence: charge.billing.recurrence,
    installment: charge.installment ?? null,
    installmentCount: charge.installmentCount ?? null,
    counterpartName: counterpartName(charge),
    proofState: charge.proof?.state ?? null,
    proofKind: charge.proof?.kind ?? null,
    ownedByViewer: charge.ownedByViewer,
    hasPix: charge.hasPayment,
    counterpartReachable: charge.counterpartReachable,
    confirmationRequired: charge.confirmationRequired,
    notify: charge.notify,
    kind: charge.billing.kind
  };
}

function totalsOf(charges: ListCharge, direction: Direction): DirectionTotals {
  const side = charges.filter((charge) => charge.type === direction);
  const pending = side.filter((charge) => charge.state === ChargeState.Pending);
  const paid = side.filter((charge) => charge.state === ChargeState.Paid);
  const sum = (rows: ListCharge) => rows.reduce((total, charge) => total + charge.amountCents, 0);

  return {
    pending: money(sum(pending)),
    count: pending.length,
    paid: money(sum(paid))
  };
}

/**
 * What the feed's summary box reads: open and settled money on each side of the month. Cancelled
 * charges count for nothing, and `count` follows `pending`, which is what the card labels.
 */
export function chargeTotals(charges: ListCharge): ChargeTotals {
  return {
    receivable: totalsOf(charges, Direction.Receivable),
    payable: totalsOf(charges, Direction.Payable)
  };
}

/** The month split into days, in the order the API answered with: one entry per due date. */
export function groupChargesByDay(charges: ListCharge): [string, ListCharge][] {
  const groups = new Map<string, ListCharge>();

  for (const charge of charges) {
    groups.set(charge.dueDate, [...(groups.get(charge.dueDate) ?? []), charge]);
  }

  return [...groups];
}

/** What a day still owes, or null once every charge of the day is closed. */
export function openChargesTotal(charges: ListCharge): Money | null {
  const pending = charges.filter((charge) => charge.state === ChargeState.Pending);

  if (!pending.length) {
    return null;
  }

  return money(pending.reduce((total, charge) => total + charge.amountCents, 0));
}
