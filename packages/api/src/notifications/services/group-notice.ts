import { ChargeState, WhatsappInstanceState, WhatsappSender } from '@receivy/common';
import { BillingRepository } from '../../billings/repositories/billing';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { ProofRepository } from '../../proofs/repositories/proof';
import { ensurePublicLink, ensureShortCode, shortLinkUrl } from '../../public/services/links';
import { AccountRepository } from '../../users/repositories/account';
import { buildChargeTemplate } from '../../vendors/whatsapp/templates';
import { WhatsappInstanceRepository } from '../repositories/whatsapp-instance';
import { WhatsappMessageRepository } from '../repositories/whatsapp-message';
import { civilDate } from './planner';
import { type GroupNoticeLine, NoticeTemplate, renderGroupNotice, renderGroupReminder } from './render';
import type { NotificationTransport } from './transport';

/** What the group path needs from `sendChargeNotice`: the charge as the notice read it. */
export type GroupCharge = ChargeRepository.NoticeRow & { billing: { whatsapp_group_jid: string } };

export type GroupContext = {
  transport: NotificationTransport;
  config: { publicOrigin: string; templates: Parameters<typeof buildChargeTemplate>[1] };
};

/** `delivered`: the group got it (now or by a sibling charge); `failed`: fall back to each person. */
export type GroupOutcome = 'delivered' | 'failed';

/** Whether a billing notifies a group: only a conta a receber stores one. */
export function groupOf(charge: ChargeRepository.NoticeRow): charge is GroupCharge {
  return Boolean(charge.billing.whatsapp_group_jid);
}

/** The person as the owner wrote them down: the nickname first, then their own name. */
async function namesOf(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, string>> {
  const nicknames = await ContactRepository.nicknames(db, ownerId, userIds);
  const names = new Map<string, string>();

  for (const userId of userIds) {
    const known = nicknames.get(userId) ?? (await AccountRepository.person(db, userId))?.name?.trim();

    names.set(userId, known?.split(/\s+/)[0] || 'Alguém');
  }

  return names;
}

/** One line per pending charge that owes something: the short link of each, minted when missing. */
async function linesOf(db: DbClient, origin: string, charges: ChargeRepository.Row[], ownerId: string, nowSeconds: number): Promise<GroupNoticeLine[]> {
  const owing = charges.filter((charge) => charge.amount_cents > 0 && charge.debtor_id);
  const names = await namesOf(
    db,
    ownerId,
    owing.map((charge) => charge.debtor_id!)
  );
  const lines: GroupNoticeLine[] = [];

  for (const charge of owing) {
    const link = await ensurePublicLink(db, charge.id, nowSeconds);
    const code = await ensureShortCode(db, link);

    lines.push({ name: names.get(charge.debtor_id!) ?? 'Alguém', cents: charge.amount_cents, url: shortLinkUrl(origin, code) });
  }

  return lines;
}

/** Siblings under review are left out: nobody is chased while the owner looks at a proof. */
async function notInReview(db: DbClient, charges: ChargeRepository.Row[]): Promise<ChargeRepository.Row[]> {
  const kept: ChargeRepository.Row[] = [];

  for (const charge of charges) {
    if ((await ProofRepository.current(db, charge.id))?.state !== StoredProofState.Pending) {
      kept.push(charge);
    }
  }

  return kept;
}

/**
 * Tells the billing's WhatsApp group about a due date, through the owner's own number. An automatic
 * notice covers every pending charge of that due date in one message, so the first charge to fire
 * sends it and its siblings find it already sent (same notice key). A manual reminder names the one
 * person it is for. Anything that keeps the group from getting it marks the billing and answers
 * `failed`, and the caller notifies each person instead.
 */
export async function sendGroupNotice(db: DbClient, context: GroupContext, charge: GroupCharge, template: NoticeTemplate, now: number, offsetDays?: number): Promise<GroupOutcome> {
  const stamp = new Date(now).toISOString();
  const manual = template === NoticeTemplate.Manual;
  const day = civilDate(now, charge.billing.owner.timezone);
  const noticeKey = manual ? `${charge.id}:manual:${day}` : `group:${charge.billing_id}:${charge.due_date}:${template}:${offsetDays ?? 'initial'}`;

  // A sibling charge of the same due date already told the group.
  if (!manual && (await WhatsappMessageRepository.live(db, noticeKey))) {
    return 'delivered';
  }

  const instance = await WhatsappInstanceRepository.byOwner(db, charge.owner_id);

  if (!instance || instance.state !== WhatsappInstanceState.Open) {
    return failed(db, charge, stamp, 'instance_closed');
  }

  const siblings = manual ? [charge] : await notInReview(db, await ChargeRepository.byBilling(db, charge.billing_id, { state: ChargeState.Pending, dueDate: charge.due_date }));
  const lines = await linesOf(db, context.config.publicOrigin, siblings, charge.owner_id, Math.floor(now / 1000));

  // Nobody owes anything on this due date: there is nothing to say, and nothing failed either.
  if (!lines.length) {
    return 'delivered';
  }

  const text = manual ? renderGroupReminder({ description: charge.description, line: lines[0]! }) : renderGroupNotice({ description: charge.description, dueDate: charge.due_date, lines }, template);
  const to = charge.billing.whatsapp_group_jid;
  const row = await WhatsappMessageRepository.insert(db, { ownerId: charge.owner_id, chargeId: charge.id, to, sender: WhatsappSender.Own, template, noticeKey, now: stamp });

  let accepted: string | null = null;

  try {
    const result = await context.transport.whatsapp({
      to,
      key: noticeKey,
      text,
      // Evolution sends the text; the template only exists because the message shape asks for one.
      template: buildChargeTemplate(
        { template, name: lines[0]!.name, creditor: charge.creditor?.name?.trim() || 'Receivy', cents: lines[0]!.cents, dueDate: charge.due_date, description: charge.description, token: '' },
        context.config.templates
      ),
      sender: WhatsappSender.Own,
      instance: { name: instance.name, token: instance.token }
    });

    accepted = result.status === 'accepted' ? result.id : null;

    if (!accepted) {
      await WhatsappMessageRepository.markFailed(db, row.id, result.status, stamp);
    }
  } catch (error) {
    console.error('WhatsApp group transport threw', { chargeId: charge.id, error: error instanceof Error ? error.message : 'unknown' });
    await WhatsappMessageRepository.markFailed(db, row.id, 'threw', stamp);
  }

  if (!accepted) {
    return failed(db, charge, stamp, 'transport');
  }

  await WhatsappMessageRepository.markSent(db, row.id, accepted, stamp);

  if (charge.billing.whatsapp_group_failed_at) {
    await BillingRepository.update(db, charge.billing_id, { whatsappGroupFailedAt: null }, stamp);
  }

  return 'delivered';
}

async function failed(db: DbClient, charge: GroupCharge, stamp: string, reason: string): Promise<GroupOutcome> {
  await BillingRepository.update(db, charge.billing_id, { whatsappGroupFailedAt: stamp }, stamp);
  await EventRepository.record(db, { type: 'notice.group_failed', eventableType: EventableType.Charge, eventableId: charge.id, payload: { reason }, at: stamp });

  return 'failed';
}
