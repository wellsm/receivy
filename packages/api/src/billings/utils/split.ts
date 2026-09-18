import {
  addCalendarDays,
  type BillingAllocation,
  type BillingInput,
  BillingRecurrence,
  type BillingSplit,
  BillingState,
  billingDates,
  billingDueDates,
  calendarDate,
  ChargePayer,
  Direction,
  materializationHorizon,
  resolveBillingSplit,
  SplitMode,
  SplitPartKind,
  type SplitParty
} from '@receivy/common';
import type { PayableMaterialization } from '../../charges/services/materialize';
import type { BillingRepository } from '../repositories/billing';
import { billingDirection, billingKind, billingRecurrence } from './columns';
import { effectiveReminders } from './reminders';

/** A billing row with the owner's timezone attached: what every calendar helper reads. */
export type BillingRow = BillingRepository.Row & { timezone: string };

/** The stored shape of one allocation, as the split is rebuilt from it. */
export type AllocationRow = { user_id: string; value?: number | null; sort_order: number; notify: boolean };

export function userIds(split: BillingSplit): string[] {
  return split.parts.flatMap((part) => (part.kind === SplitPartKind.User ? [part.userId] : []));
}

/** The one person a charge planned for the whole total names: the payer of a conta a receber settled as one. */
export function counterpartIdOf(split: BillingSplit): string | undefined {
  return userIds(split)[0];
}

/** What `prepareChargeMaterialization` needs to know about a conta a pagar, or undefined for a conta a receber. */
export function payableOf(row: Pick<BillingRepository.Row, 'contact_id'>): PayableMaterialization | undefined {
  return billingDirection(row) === Direction.Payable ? { payer: ChargePayer.Owner, contactId: row.contact_id } : undefined;
}

export function calendarRule(row: BillingRepository.Row) {
  return { frequency: row.frequency!, startDate: row.start_date, endDate: row.end_date, dueRule: row.due_rule };
}

export function installmentCountFor(row: BillingRepository.Row): number | undefined {
  if (billingRecurrence(row) === BillingRecurrence.Indefinite) {
    return undefined;
  }

  return billingDueDates({
    recurrence: billingRecurrence(row),
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule
  }).length;
}

/** Occurrences already past their materialization date, oldest first. */
export function dueOccurrences(row: BillingRow, now: Date, limit: number): string[] {
  if (row.state !== BillingState.Active || billingRecurrence(row) !== BillingRecurrence.Indefinite) {
    return [];
  }

  const today = calendarDate(now, row.timezone);
  const latest = materializationHorizon(today, effectiveReminders(row));
  const cursor = row.last_occurrence_date ?? addCalendarDays(row.start_date, -1);

  return billingDates(calendarRule(row), addCalendarDays(cursor, 1), latest, limit);
}

export function billingInputFrom(row: BillingRow, split: BillingSplit): BillingInput {
  const direction = billingDirection(row);

  return {
    recurrence: billingRecurrence(row),
    frequency: row.frequency,
    description: row.description,
    totalCents: row.total_cents,
    startDate: row.start_date,
    endDate: row.end_date,
    dueRule: row.due_rule,
    timezone: row.timezone,
    paymentMethodId: row.payment_method_id,
    // A conta a pagar takes no split as input: the normalizer settles it on the owner, as it did at creation.
    split: direction === Direction.Payable ? undefined : split,
    category: row.category,
    contactId: row.contact_id,
    kind: billingKind(row)
  };
}

/** The raw number of a stored part; `equal` is the one mode that keeps none. */
function splitValue(row: { value?: number | null }): number {
  return row.value ?? 0;
}

/** What each mode keeps in `value`: cents on `fixed`, basis points on `percentage`, the quota on `shares`. */
export function storedValue(mode: SplitMode, original: BillingSplit['parts'][number] | undefined, amountCents: number): number | undefined {
  if (mode === SplitMode.Fixed) {
    return amountCents;
  }

  if (mode === SplitMode.Percentage) {
    return original && 'basisPoints' in original ? original.basisPoints : undefined;
  }

  if (mode === SplitMode.Shares) {
    return original && 'shares' in original ? original.shares : undefined;
  }

  return undefined;
}

/** The part's own value wins; a participant who stays without one keeps theirs; the owner part always notifies. */
export function notifyFor(part: SplitParty, before: Map<string, boolean>): boolean {
  if (part.kind !== SplitPartKind.User) {
    return true;
  }

  if (part.notify !== undefined) {
    return part.notify;
  }

  return before.get(part.userId) ?? true;
}

/** What the stored parts cannot say on their own: the mode, who the owner is, and the total the amounts resolve from. */
export type SplitSource = Pick<BillingRepository.Row, 'id' | 'owner_id' | 'total_cents' | 'split_mode'>;

/** The split and the resolved allocations of a billing, rebuilt from its stored parts. */
export function splitOf(billing: SplitSource, rows: AllocationRow[]): { split: BillingSplit; allocations: BillingAllocation[] } {
  const mode = billing.split_mode ?? SplitMode.Equal;
  const owns = (userId: string) => userId === billing.owner_id;
  const parties = rows.map((row) => (owns(row.user_id) ? { kind: SplitPartKind.Owner as const } : { kind: SplitPartKind.User as const, userId: row.user_id }));
  const split: BillingSplit =
    mode === SplitMode.Fixed
      ? { mode, parts: rows.flatMap((row) => (owns(row.user_id) ? [] : [{ kind: SplitPartKind.User as const, userId: row.user_id, amountCents: splitValue(row) }])) }
      : mode === SplitMode.Equal
        ? { mode, parts: parties }
        : mode === SplitMode.Shares
          ? { mode, parts: parties.map((party, index) => ({ ...party, shares: splitValue(rows[index]!) || 1 })) }
          : { mode, parts: parties.map((party, index) => ({ ...party, basisPoints: splitValue(rows[index]!) })) };
  // The stored parts carry the raw value; what each side owes is recomputed, never read back from a column.
  const resolved = resolveBillingSplit(billing.total_cents, split);
  const allocations = rows.map((row, index) => ({
    kind: owns(row.user_id) ? SplitPartKind.Owner : SplitPartKind.User,
    // The owner part reads as null here, the same shape the clients always saw.
    userId: owns(row.user_id) ? null : row.user_id,
    splitMode: mode,
    amount: { amountCents: resolved[index]?.amountCents ?? 0, currency: 'BRL' as const },
    order: row.sort_order,
    notify: row.notify,
    ...(mode === SplitMode.Shares ? { shares: splitValue(row) || 1 } : {})
  }));

  return { split, allocations };
}
