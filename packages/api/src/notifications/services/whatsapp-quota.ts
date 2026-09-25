import { PLAN_LIMITS, planOf, WhatsappInstanceState, WhatsappSender } from '@receivy/common';
import type { DbClient } from '../../database';
import { SubscriptionRepository } from '../../plans/repositories/subscription';
import { AccountRepository } from '../../users/repositories/account';
import { WhatsappInstanceRepository } from '../repositories/whatsapp-instance';
import { WhatsappMessageRepository } from '../repositories/whatsapp-message';

export type Cycle = { from: string; to: string };

/** The quota window: one month back from the Stripe period end, or the UTC calendar month when there is no period. */
export function cycleOf(currentPeriodEnd: string | null, now: Date): Cycle {
  if (!currentPeriodEnd) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    return { from: from.toISOString(), to: to.toISOString() };
  }

  const to = new Date(currentPeriodEnd);
  const from = new Date(to);
  const day = to.getUTCDate();

  // Set the day first so a 31st does not spill into the month after the target one.
  from.setUTCDate(1);
  from.setUTCMonth(from.getUTCMonth() - 1);

  const last = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();

  from.setUTCDate(Math.min(day, last));

  return { from: from.toISOString(), to: to.toISOString() };
}

export type WhatsappReach = {
  sender: WhatsappSender;
  /** Whether the owner's own instance is connected right now; always false on the Receivy sender. */
  instanceOpen: boolean;
  /** What the evolution transport needs; null on the Receivy sender or without a paired number. */
  instance: { name: string; token: string } | null;
  quotaLeft: number;
  quotaLimit: number;
};

/**
 * Everything `resolveChannels` needs to know about the owner's WhatsApp: whose number, whether
 * it is up, and how many Receivy-number messages the plan cycle still allows. The count is a
 * real query, so callers only ask once the channel is wanted and the recipient is reachable.
 */
export async function whatsappReach(db: DbClient, ownerId: string, now: Date): Promise<WhatsappReach> {
  const sender = await AccountRepository.whatsappSender(db, ownerId);

  if (sender === WhatsappSender.Own) {
    const row = await WhatsappInstanceRepository.byOwner(db, ownerId);
    const open = row?.state === WhatsappInstanceState.Open;

    return { sender, instanceOpen: open, instance: row && open ? { name: row.name, token: row.token } : null, quotaLeft: 0, quotaLimit: 0 };
  }

  const subscription = await SubscriptionRepository.get(db, ownerId);
  const plan = planOf(SubscriptionRepository.snapshotOf(subscription), now);
  const quotaLimit = PLAN_LIMITS[plan].whatsappMessages;

  if (quotaLimit <= 0) {
    return { sender, instanceOpen: false, instance: null, quotaLeft: 0, quotaLimit };
  }

  const cycle = cycleOf(subscription?.current_period_end ?? null, now);
  const used = await WhatsappMessageRepository.countInCycle(db, ownerId, cycle.from, cycle.to);

  return { sender, instanceOpen: false, instance: null, quotaLeft: Math.max(quotaLimit - used, 0), quotaLimit };
}
