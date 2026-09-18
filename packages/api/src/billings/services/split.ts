import { type BillingAllocation, type BillingSplit, resolveBillingSplit, SplitPartKind, type SplitParty } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { AllocationRepository } from '../repositories/allocation';
import type { BillingRepository } from '../repositories/billing';
import { notifyFor, splitOf, type SplitSource, storedValue } from '../utils/split';

/** A participant whose automatic notices the saved split changed, for them or for their leftover pending charges. */
export type NotifyChange = { userId: string; notify: boolean };

export async function splitFor(db: DbClient, billing: SplitSource): Promise<{ split: BillingSplit; allocations: BillingAllocation[] }> {
  return splitOf(billing, await AllocationRepository.byBilling(db, billing.id));
}

export async function auditBilling(db: DbClient, ownerId: string, id: string, type: string, now: string, payload: Record<string, unknown> = {}): Promise<void> {
  await EventRepository.record(db, { type, eventableType: EventableType.Billing, eventableId: id, actorId: ownerId, payload, at: now });
}

/** A participant's switch lands on their pending charges of the billing; paid and cancelled ones keep theirs. */
export async function setPendingChargesNotify(db: DbClient, billingId: string, userId: string, notify: boolean, now: string): Promise<void> {
  await ChargeRepository.setPendingNotify(db, billingId, userId, notify, now);
}

/**
 * Whoever stayed follows their allocation. Whoever enters sending a value also moves the pending charges a
 * next-month edit left behind when they were removed, as long as those charges carry a different value.
 */
async function notifyChange(db: DbClient, billingId: string, part: SplitParty, before: Map<string, boolean>, notify: boolean): Promise<NotifyChange | undefined> {
  if (part.kind !== SplitPartKind.User) {
    return undefined;
  }

  if (before.has(part.userId)) {
    return before.get(part.userId) === notify ? undefined : { userId: part.userId, notify };
  }

  if (part.notify === undefined) {
    return undefined;
  }

  const flags = await ChargeRepository.pendingNotifyFlags(db, billingId, part.userId);

  return flags.some((current) => current !== notify) ? { userId: part.userId, notify } : undefined;
}

/**
 * Rewrites the allocations of a billing. Whoever stays keeps their `notify` unless the part sends one; whoever
 * enters takes the part's value (absent notifies). Returns the changes of those who stayed, and of whoever came
 * back sending a value their leftover pending charges lack, so those charges can follow.
 */
export async function saveAllocations(
  db: DbClient,
  billing: Pick<BillingRepository.Row, 'id' | 'owner_id'>,
  totalCents: number,
  split: BillingSplit,
  now: string
): Promise<NotifyChange[]> {
  const { id, owner_id: ownerId } = billing;
  const resolved = resolveBillingSplit(totalCents, split);
  const before = await AllocationRepository.notifyOf(db, id, ownerId);
  const changes: NotifyChange[] = [];
  const rows: { userId: string; notify: boolean; value?: number }[] = [];

  for (const [index, part] of resolved.entries()) {
    const notify = notifyFor(part, before);
    const change = await notifyChange(db, id, part, before, notify);

    if (change) {
      changes.push(change);
    }

    rows.push({
      // The owner's own part carries the owner: that is what tells the two sides apart now.
      userId: part.kind === SplitPartKind.User ? part.userId : ownerId,
      // The owner's own part has nobody to notify, so it carries the neutral true.
      notify: part.kind === SplitPartKind.User ? notify : true,
      value: storedValue(split.mode, split.parts[index], part.amountCents)
    });
  }

  await AllocationRepository.replace(db, id, rows, now);

  return changes;
}
