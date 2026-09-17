import { ChargeState, Direction, type Money } from './contracts';

export type ListChargeItem = {
  id: string;
  description: string;
  installment?: number;
  installment_count?: number;
  state: string;
  due_date: string;
  amount_cents: number;
  billing: {
    type: string;
    direction: Direction;
  };
  debtor?: {
    name?: string;
    email?: string;
    phone?: string;
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

/**
 * Which side of a charge the viewer is on: `debtor` is whoever pays it, so the viewer pays when that
 * is them and receives otherwise. The list only ever holds charges the viewer is on one side of.
 */
export function chargeDirection(charge: ListChargeItem, viewerEmail: string): Direction {
  const pays = !!viewerEmail && charge.debtor?.email === viewerEmail;

  return pays ? Direction.Payable : Direction.Receivable;
}

function money(amountCents: number): Money {
  return { amountCents, currency: 'BRL' };
}

function totalsOf(viewerEmail: string, charges: ListCharge, direction: Direction): DirectionTotals {
  const side = charges.filter((charge) => chargeDirection(charge, viewerEmail) === direction);
  const pending = side.filter((charge) => charge.state === ChargeState.Pending);
  const paid = side.filter((charge) => charge.state === ChargeState.Paid);
  const sum = (rows: ListCharge) => rows.reduce((total, charge) => total + charge.amount_cents, 0);

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
export function chargeTotals(viewerEmail: string, charges: ListCharge): ChargeTotals {
  return {
    receivable: totalsOf(viewerEmail, charges, Direction.Receivable),
    payable: totalsOf(viewerEmail, charges, Direction.Payable)
  };
}

/** The month split into days, in the order the API answered with: one entry per due date. */
export function groupChargesByDay(charges: ListCharge): [string, ListCharge][] {
  const groups = new Map<string, ListCharge>();

  for (const charge of charges) {
    groups.set(charge.due_date, [...(groups.get(charge.due_date) ?? []), charge]);
  }

  return [...groups];
}

/** What a day still owes, or null once every charge of the day is closed. */
export function openChargesTotal(charges: ListCharge): Money | null {
  const pending = charges.filter((charge) => charge.state === ChargeState.Pending);

  if (!pending.length) {
    return null;
  }

  return money(pending.reduce((total, charge) => total + charge.amount_cents, 0));
}
