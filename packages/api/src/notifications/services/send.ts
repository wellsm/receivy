import type { Client } from '@ez4/scheduler';
import { addCalendarDays, ChargeState } from '@receivy/common';
import { billingRegistered } from '../../billings/utils/columns';
import { effectiveReminders } from '../../billings/utils/reminders';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { ownerPays, paymentOf } from '../../charges/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { ProofRepository } from '../../proofs/repositories/proof';
import { ensurePublicLink } from '../../public/services/links';
import { DeviceRepository } from '../repositories/device';
import { EMAIL_FOLLOWUP_MS, instantAt, type NotificationConfig, PLAN_WINDOW_MS, REMINDER_HOUR, shouldSendInitialNotice } from './planner';
import { NoticeTemplate, renderNotice } from './render';
import type { NotificationTransport } from './transport';

export { NoticeTemplate };

export const enum NoticeChannel {
  Push = 'push',
  Email = 'email'
}

/**
 * What `charge:<id>:notify` carries. `first` is the notice itself (push, or e-mail when there is no
 * device); `followup` is the e-mail two hours after a push that got no proof back.
 */
export type ChargeNotifyEvent = { chargeId: string; template: NoticeTemplate; stage: 'first' | 'followup'; offsetDays?: number };

export type NotifyScheduler = Pick<Client<ChargeNotifyEvent>, 'setEvent' | 'deleteEvent'>;

/** Everything a producer needs to tell someone about a charge, now or later. */
export type NoticeContext = {
  config: NotificationConfig;
  transport: NotificationTransport;
  notify: NotifyScheduler;
};

export const notifyIdentifier = (chargeId: string) => `charge:${chargeId}:notify`;

const PUSH_BODY = 'Confira os detalhes da cobrança no Receivy.';

/** `auto`: push, e-mail only without a device. `email`: the follow-up. `both`: push and e-mail at once. */
export type SendOptions = { offsetDays?: number; channel?: 'auto' | 'email' | 'both' };

export type SendResult = { channels: NoticeChannel[] };

const enum SkipReason {
  InReview = 'in_review',
  Silenced = 'silenced',
  Settled = 'settled',
  NoRecipient = 'no_recipient',
  PixRequired = 'pix_required',
  NoChannel = 'no_channel'
}

const NOTHING: SendResult = { channels: [] };

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

/** Whether an e-mail already went out for this template and offset, so a redelivery never mails twice. */
async function emailAlreadySent(db: DbClient, event: ChargeNotifyEvent): Promise<boolean> {
  const sent = await EventRepository.list(db, event.chargeId, 'notice.sent');

  return sent.some(
    (entry) =>
      entry.payload['template'] === event.template &&
      entry.payload['offsetDays'] === event.offsetDays &&
      (entry.payload['channels'] as string[] | undefined)?.includes(NoticeChannel.Email)
  );
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
 * Tells the person who has to pay (or, on a conta a pagar, the owner) about the charge. `auto` pushes to
 * every active device and falls back to e-mail only when there is none; `email` is the follow-up; `both`
 * is the manual reminder, which goes out on every channel at once and needs no follow-up. The
 * outcome is one `notice.sent` event, or `notice.skipped` when nobody could be reached. Nothing is
 * retried here: the follow-up, the next reminder or the button tries again.
 */
export async function sendChargeNotice(
  db: DbClient,
  context: NoticeContext,
  chargeId: string,
  template: NoticeTemplate,
  now = Date.now(),
  options: SendOptions = {}
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

  // The creditor paused the automatic notices: only the manual reminder (channel 'both') still reaches the debtor.
  if (!charge.notify && options.channel !== 'both') {
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
      self: ownBill
    },
    template,
    context.config.secret
  );
  const wantsPush = options.channel !== 'email' && context.config.pushAvailable !== false;
  // One entry per device that took the push: the event says how many screens the notice landed on.
  const pushed = wantsPush ? await pushToDevices(db, context.transport, target.id, { title: rendered.subject, url: rendered.url }, now) : 0;
  const channels: NoticeChannel[] = Array.from({ length: pushed }, () => NoticeChannel.Push);

  const wantsEmail = options.channel === 'both' || !channels.length;

  if (wantsEmail && !ownBill && target.email) {
    const result = await context.transport.email({
      to: target.email,
      key: `${chargeId}:${template}:${now}`,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      from: context.config.from ?? 'disabled'
    });

    if (result.status === 'accepted') {
      channels.push(NoticeChannel.Email);
    }
  }

  await EventRepository.record(db, {
    type: channels.length ? 'notice.sent' : 'notice.skipped',
    eventableType: EventableType.Charge,
    eventableId: chargeId,
    payload: { ...payload, channels, ...(channels.length ? {} : { reason: SkipReason.NoChannel }) },
    at: new Date(now).toISOString()
  });

  return { channels };
}

/**
 * The notice plus its rule: a push that went out gets the e-mail follow-up armed two hours later, on the
 * charge's single `charge:<id>:notify` schedule. An e-mail sent right away needs no follow-up.
 */
export async function notifyCharge(
  db: DbClient,
  context: NoticeContext,
  chargeId: string,
  template: NoticeTemplate,
  now = Date.now(),
  offsetDays?: number
): Promise<SendResult> {
  const result = await sendChargeNotice(db, context, chargeId, template, now, { offsetDays, channel: 'auto' });

  if (result.channels.includes(NoticeChannel.Push)) {
    await context.notify
      .setEvent(notifyIdentifier(chargeId), {
        date: new Date(now + EMAIL_FOLLOWUP_MS),
        event: { chargeId, template, stage: 'followup', ...(offsetDays === undefined ? {} : { offsetDays }) }
      })
      .catch(() => undefined);
  }

  return result;
}

/** The two-hour follow-up: e-mail only, and only while the charge is still open with nothing to review. */
export async function followUpCharge(db: DbClient, context: NoticeContext, event: ChargeNotifyEvent, now = Date.now()): Promise<SendResult> {
  const charge = await ChargeRepository.forNotice(db, event.chargeId);

  if (!charge || charge.state !== ChargeState.Pending) {
    return NOTHING;
  }

  if (await inReview(db, event.chargeId)) {
    return NOTHING;
  }

  // Silenced between the push and this e-mail: the creditor's latest word wins.
  if (!charge.notify) {
    return NOTHING;
  }

  if (billingRegistered(charge.billing)) {
    return NOTHING;
  }

  if (await emailAlreadySent(db, event)) {
    return NOTHING;
  }

  return sendChargeNotice(db, context, event.chargeId, event.template, now, { offsetDays: event.offsetDays, channel: 'email' });
}

/** Fired at charge creation (after the transaction): the first notice, with its follow-up rule. */
export async function announceCharges(db: DbClient, context: NoticeContext, chargeIds: string[], now = Date.now()): Promise<void> {
  for (const chargeId of chargeIds) {
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
 * charge; the handler re-arms it for the follow-up.
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
        event: { chargeId: charge.id, template: NoticeTemplate.Reminder, stage: 'first', offsetDays: reminder.offsetDays }
      });

      planned++;
    }
  }

  return planned;
}
