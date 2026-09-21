import type { Client } from '@ez4/scheduler';
import { addCalendarDays, type ChannelSet, channelsFor, ChargeState, PaymentLinkState, type ReminderTemplate } from '@receivy/common';
import { billingRegistered } from '../../billings/utils/columns';
import { effectiveConfigOf, effectiveReminders } from '../../billings/utils/reminders';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { checkoutProviderOf, ensurePaymentLink } from '../../charges/services/payment-link';
import { ownerPays, paymentOf } from '../../charges/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { ProofRepository } from '../../proofs/repositories/proof';
import { issueOptOutToken } from '../../public/services/capability';
import { ensurePublicLink } from '../../public/services/links';
import type { CheckoutClients } from '../../vendors/checkout/types';
import { DeviceRepository } from '../repositories/device';
import { type Dropped, NoticeChannel, resolveChannels } from './channels';
import { instantAt, type NotificationConfig, PLAN_WINDOW_MS, REMINDER_HOUR, shouldSendInitialNotice } from './planner';
import { NoticeTemplate, renderNotice } from './render';
import type { NotificationTransport } from './transport';

export { NoticeChannel, NoticeTemplate };

/** What `charge:<id>:notify` carries: which notice is due for the charge, and under which rule. */
export type ChargeNotifyEvent = { chargeId: string; template: NoticeTemplate; offsetDays?: number };

export type NotifyScheduler = Pick<Client<ChargeNotifyEvent>, 'setEvent' | 'deleteEvent'>;

/** Everything a producer needs to tell someone about a charge, now or later. */
export type NoticeContext = {
  config: NotificationConfig;
  transport: NotificationTransport;
  links: CheckoutClients;
};

export const notifyIdentifier = (chargeId: string) => `charge:${chargeId}:notify`;

const PUSH_BODY = 'Confira os detalhes da cobrança no Receivy.';

/** Which configurable channels this notice wants, already resolved from the rule that fired it. */
export type SendOptions = { offsetDays?: number; channels: ChannelSet };

export type SendResult = { channels: NoticeChannel[]; dropped: Dropped[] };

const enum SkipReason {
  InReview = 'in_review',
  Silenced = 'silenced',
  Settled = 'settled',
  NoRecipient = 'no_recipient',
  PixRequired = 'pix_required',
  LinkPending = 'link_pending',
  NoChannel = 'no_channel'
}

const NOTHING: SendResult = { channels: [], dropped: [] };

/** What `ensurePaymentLink` needs, read off the notice config. */
function linkConfig(config: NotificationConfig) {
  return { apiOrigin: config.apiOrigin, webOrigin: config.publicOrigin, secret: config.secret, credentialKeyB64: config.credentialKeyB64 };
}

/** The template as the shared rules name it: the domain speaks a string union, the API a const enum. */
function templateRule(template: NoticeTemplate): ReminderTemplate {
  if (template === NoticeTemplate.Manual) {
    return 'manual';
  }

  if (template === NoticeTemplate.Initial) {
    return 'initial';
  }

  return 'reminder';
}

function noticePayload(template: NoticeTemplate, offsetDays?: number): Record<string, unknown> {
  return { template, ...(offsetDays === undefined ? {} : { offsetDays }) };
}

async function skipped(db: DbClient, chargeId: string, payload: Record<string, unknown>, reason: SkipReason): Promise<SendResult> {
  await EventRepository.record(db, { type: 'notice.skipped', eventableType: EventableType.Charge, eventableId: chargeId, payload: { ...payload, reason } });

  return NOTHING;
}

/** Whether a proof is under review for the charge: nothing chases anyone while the other side answers. */
async function inReview(db: DbClient, chargeId: string): Promise<boolean> {
  return (await ProofRepository.current(db, chargeId))?.state === StoredProofState.Pending;
}

/** Pushes to every active device of the target and counts the ones that took it; a device the provider forgot is switched off. */
async function pushToDevices(db: DbClient, transport: NotificationTransport, userId: string, notice: { title: string; url: string }, now: number): Promise<number> {
  const devices = await DeviceRepository.active(db, userId);

  let reached = 0;

  for (const device of devices) {
    const result = await transport.push({ token: device.token, title: notice.title, body: PUSH_BODY, url: notice.url });

    if (result.status === 'accepted') {
      reached++;
    } else if (result.status === 'device_unregistered') {
      await DeviceRepository.deactivate(db, device.id, new Date(now).toISOString());
    }
  }

  return reached;
}

/**
 * Tells the person who has to pay (or, on a conta a pagar, the owner) about the charge. The push goes to
 * every active device and is implicit; the configurable channels come from the rule that fired, and each
 * one nobody could take is reported with its reason. The outcome is one `notice.sent` event, or
 * `notice.skipped` when nobody could be reached. Nothing is retried here: the next reminder or the
 * button tries again.
 */
export async function sendChargeNotice(
  db: DbClient,
  context: NoticeContext,
  chargeId: string,
  template: NoticeTemplate,
  now = Date.now(),
  options: SendOptions
): Promise<SendResult> {
  const charge = await ChargeRepository.forNotice(db, chargeId);

  if (!charge || charge.state !== ChargeState.Pending) {
    return NOTHING;
  }

  const payload = noticePayload(template, options.offsetDays);

  // Somebody said it was paid, with a file or without: nothing chases them while the other side answers.
  if (await inReview(db, chargeId)) {
    return skipped(db, chargeId, payload, SkipReason.InReview);
  }

  // The creditor paused the automatic notices: only the manual reminder still reaches the debtor.
  if (!charge.notify && template !== NoticeTemplate.Manual) {
    return skipped(db, chargeId, payload, SkipReason.Silenced);
  }

  // A registro was already received or paid: nobody hears about it, not even through the manual reminder.
  if (billingRegistered(charge.billing)) {
    return skipped(db, chargeId, payload, SkipReason.Settled);
  }

  const ownBill = ownerPays(charge);
  // Whoever has to pay hears about it: the debtor, which on a conta a pagar is the owner.
  const target = charge.debtor && !charge.debtor.deleted_at ? charge.debtor : undefined;

  if (!target) {
    return skipped(db, chargeId, payload, SkipReason.NoRecipient);
  }

  // The notice carries the payment link, so a conta a receber without a key has nothing to send yet.
  if (!ownBill && !paymentOf(charge)) {
    return skipped(db, chargeId, payload, SkipReason.PixRequired);
  }

  const snapshot = paymentOf(charge);

  // A checkout charge is announced with its link ready; a link still failing is tried once more here.
  if (!ownBill && snapshot && checkoutProviderOf(snapshot.provider)) {
    const state = await ensurePaymentLink(db, context.links, linkConfig(context.config), chargeId, now, context.transport);

    if (state !== PaymentLinkState.Ready) {
      return skipped(db, chargeId, payload, SkipReason.LinkPending);
    }
  }

  // The owner pays their own bill: no link is minted for them, and the notice carries none.
  const link = ownBill ? null : await ensurePublicLink(db, charge.id, Math.floor(now / 1000));
  const rendered = renderNotice(
    {
      email: ownBill ? undefined : target.email,
      name: target.name?.trim() || target.email || 'Conta excluída',
      description: charge.description,
      cents: charge.amount_cents,
      dueDate: charge.due_date,
      publicId: link?.public_id ?? '',
      expires: link ? Math.floor(Date.parse(link.expires_at) / 1000) : 0,
      origin: context.config.publicOrigin,
      from: context.config.from ?? 'disabled',
      self: ownBill,
      provider: paymentOf(charge)?.provider,
      optOutUrl:
        ownBill || !target.email
          ? undefined
          : `${context.config.publicOrigin}/opt-out/${issueOptOutToken({ userId: target.id, email: target.email, secret: context.config.secret })}`
    },
    template,
    context.config.secret
  );
  // Only a conta a receber has a creditor to have filed a phone for the debtor.
  const reach = ownBill || !charge.creditor_id ? null : await ContactRepository.reachability(db, charge.creditor_id, target.id);
  const resolved = resolveChannels({ wanted: options.channels, ownBill, target, contact: reach, whatsappAvailable: context.config.whatsappAvailable });
  const wantsPush = context.config.pushAvailable !== false;
  // One entry per device that took the push: the event says how many screens the notice landed on.
  const pushed = wantsPush ? await pushToDevices(db, context.transport, target.id, { title: rendered.subject, url: rendered.url }, now) : 0;
  const channels: NoticeChannel[] = Array.from({ length: pushed }, () => NoticeChannel.Push);

  if (resolved.email && target.email) {
    const result = await context.transport.email({
      to: target.email,
      key: `${chargeId}:${template}:${now}`,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      from: context.config.from ?? 'disabled',
      headers: rendered.optOutUrl ? { 'List-Unsubscribe': `<${rendered.optOutUrl}>` } : undefined
    });

    if (result.status === 'accepted') {
      channels.push(NoticeChannel.Email);
    }
  }

  // Phase 3 sends here; today `resolved.whatsapp` is always false because the transport is unavailable.

  await EventRepository.record(db, {
    type: channels.length ? 'notice.sent' : 'notice.skipped',
    eventableType: EventableType.Charge,
    eventableId: chargeId,
    payload: {
      ...payload,
      channels,
      ...(resolved.dropped.length ? { dropped: resolved.dropped } : {}),
      ...(channels.length ? {} : { reason: SkipReason.NoChannel })
    },
    at: new Date(now).toISOString()
  });

  return { channels, dropped: resolved.dropped };
}

/** The notice plus its rule: which channels this template and offset ask for, on this billing's configuration. */
export async function notifyCharge(
  db: DbClient,
  context: NoticeContext,
  chargeId: string,
  template: NoticeTemplate,
  now = Date.now(),
  offsetDays?: number
): Promise<SendResult> {
  const charge = await ChargeRepository.forNotice(db, chargeId);

  if (!charge) {
    return NOTHING;
  }

  const channels = channelsFor(effectiveConfigOf(charge.billing), templateRule(template), offsetDays);

  return sendChargeNotice(db, context, chargeId, template, now, { offsetDays, channels });
}

/** Fired at charge creation (after the transaction): the first notice of the charge. */
export async function announceCharges(db: DbClient, context: NoticeContext, chargeIds: string[], now = Date.now()): Promise<void> {
  for (const chargeId of chargeIds) {
    // Created a moment ago, outside the transaction: the checkout link is asked for now, whether or not the notice is due yet.
    try {
      await ensurePaymentLink(db, context.links, linkConfig(context.config), chargeId, now, context.transport);
    } catch (error) {
      console.error('Payment link creation failed after commit', { chargeId, error: error instanceof Error ? error.message : 'unknown' });
    }

    const charge = await ChargeRepository.forNotice(db, chargeId);

    // The owner of a conta a pagar just typed it: only the scheduled reminders reach them.
    if (!charge || ownerPays(charge)) {
      continue;
    }

    // A silenced charge gets no hello; the manual reminder is still there.
    if (!charge.notify) {
      continue;
    }

    // A registro has nobody to greet.
    if (billingRegistered(charge.billing)) {
      continue;
    }

    // The billing has no timezone of its own: the owner's is what dates the notice. A charge created ahead
    // of its due day meets the debtor through the reminders, not on the day it was created.
    const due = shouldSendInitialNotice({
      dueDate: charge.due_date,
      now,
      timezone: charge.billing.owner.timezone,
      reminders: effectiveReminders(charge.billing)
    });

    if (!due) {
      continue;
    }

    await notifyCharge(db, context, chargeId, NoticeTemplate.Initial, now);
  }
}

/**
 * The daily plan: every pending charge whose reminder (due date + offset, 06:00 in the billing timezone)
 * falls inside the next 24 hours gets `charge:<id>:notify` pointed at that instant. One schedule per
 * charge, one hop per reminder.
 */
export async function planReminders(db: DbClient, notify: NotifyScheduler, now = Date.now()): Promise<number> {
  const from = new Date(now - 100 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(now + 100 * 86400_000).toISOString().slice(0, 10);
  const charges = await ChargeRepository.pendingDueBetween(db, from, to);
  // One query for the sweep: the proof moved to its own table and this loop must not go charge by charge.
  const proofs = await ProofRepository.byCharges(
    db,
    charges.map((charge) => charge.id)
  );

  let planned = 0;

  for (const charge of charges) {
    if (proofs.get(charge.id)?.state === StoredProofState.Pending) {
      continue;
    }

    if (!charge.notify) {
      continue;
    }

    if (billingRegistered(charge.billing)) {
      continue;
    }

    const timezone = charge.billing.owner.timezone;

    for (const reminder of effectiveReminders(charge.billing)) {
      if (!reminder.enabled) {
        continue;
      }

      const at = instantAt(addCalendarDays(charge.due_date, reminder.offsetDays), REMINDER_HOUR, timezone);

      if (at.getTime() < now || at.getTime() >= now + PLAN_WINDOW_MS) {
        continue;
      }

      await notify.setEvent(notifyIdentifier(charge.id), {
        date: at,
        event: { chargeId: charge.id, template: NoticeTemplate.Reminder, offsetDays: reminder.offsetDays }
      });

      planned++;
    }
  }

  return planned;
}
