import { BillingRecurrence, BillingState } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { BillingRepository } from '../repositories/billing';

/**
 * An única or parcelada has every charge from the start, so once none is pending and at least one was paid there is
 * nothing left to follow: it ends on its own and leaves the Ativas list. A recorrente never does. Called inside the
 * transaction that moved a charge, after the move.
 */
export async function closeWhenSettled(tx: DbClient, billingId: string, now: string): Promise<void> {
  // Read unlocked first: a recorrente materializes and registers charges alongside account erasure, and must not
  // take the billing row there.
  const peek = await BillingRepository.settlement(tx, billingId);

  if (!peek || peek.recurrence === BillingRecurrence.Indefinite) {
    return;
  }

  const billing = (await BillingRepository.settlement(tx, billingId, true))!;

  if (billing.state !== BillingState.Active && billing.state !== BillingState.Paused) {
    return;
  }

  const { pending, paid } = await ChargeRepository.tally(tx, billingId);

  if (pending || !paid) {
    return;
  }

  await BillingRepository.markSettled(tx, billingId, now);
  await EventRepository.record(tx, { type: 'billing.auto_ended', eventableType: EventableType.Billing, eventableId: billingId, at: now });
}

/** A charge reopened on a billing that ended on its own brings it back; one ended by hand stays ended. */
export async function reopenWhenUnsettled(tx: DbClient, billingId: string, now: string): Promise<void> {
  const billing = await BillingRepository.settlement(tx, billingId, true);

  if (!billing?.auto_ended_at || billing.state !== BillingState.Ended) {
    return;
  }

  await BillingRepository.clearSettled(tx, billingId, now);
  await EventRepository.record(tx, { type: 'billing.reopened', eventableType: EventableType.Billing, eventableId: billingId, at: now });
}
