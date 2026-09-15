import type { Client } from '@ez4/scheduler';
import { addCalendarDays, ChargePayer, ChargeState } from '@receivy/common';
import { effectiveReminders } from '../../billings/services/reminders';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { ensurePublicLink, linkAlive } from '../../public/services/links';
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
  const charge = await db.charges.findOne({ select: ChargeRepository.SELECT, where: { id: chargeId } });

  if (!charge || charge.state !== ChargeState.Pending) {
    return { channels: [] };
  }

  // Somebody said it was paid, with a file or without: nothing chases them while the other side answers.
  if (charge.proof_state === StoredProofState.Pending) {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }), reason: 'in_review' }
    });
    return { channels: [] };
  }

  // The creditor paused the automatic notices: only the manual reminder (channel 'both') still reaches the debtor.
  if (charge.silenced && options.channel !== 'both') {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }), reason: 'silenced' }
    });
    return { channels: [] };
  }

  const billing = await db.billings.findOne({ select: { settled: true }, where: { id: charge.billing_id } });

  // A registro was already received or paid: nobody hears about it, not even through the manual reminder.
  if (billing?.settled) {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }), reason: 'settled' }
    });
    return { channels: [] };
  }

  const ownerPays = ChargeRepository.payer(charge) === ChargePayer.Owner;
  const targetId = ownerPays ? charge.creditor_id : charge.debtor_user_id;
  const target = targetId
    ? await db.users.findOne({ select: { id: true, name: true, email: true }, where: { id: targetId, deleted_at: { isNull: true } } })
    : undefined;
  const payload = { template, ...(options.offsetDays === undefined ? {} : { offsetDays: options.offsetDays }) };

  if (!target) {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { ...payload, reason: 'no_recipient' }
    });
    return { channels: [] };
  }

  const hasPix = !!charge.pix_key_snapshot && !!charge.pix_key_type_snapshot;

  // The notice carries the payment link, so a conta a receber without a key has nothing to send yet.
  if (!ownerPays && !hasPix) {
    await EventRepository.record(db, {
      type: 'notice.skipped',
      eventableType: EventableType.Charge,
      eventableId: chargeId,
      payload: { ...payload, reason: 'pix_required' }
    });
    return { channels: [] };
  }

  const nowSeconds = Math.floor(now / 1000);
  const published = ownerPays || linkAlive(charge, nowSeconds) ? charge : await ensurePublicLink(db, charge, nowSeconds);
  const rendered = renderNotice(
    {
      email: ownerPays ? undefined : target.email,
      name: target.name?.trim() || target.email || 'Conta excluída',
      description: published.description,
      cents: published.amount_cents,
      dueDate: published.due_date,
      publicId: published.public_id ?? '',
      version: published.link_version ?? 0,
      expires: published.link_expires_at ? Math.floor(Date.parse(published.link_expires_at) / 1000) : 0,
      origin: context.config.publicOrigin,
      from: context.config.from ?? 'disabled',
      self: ownerPays
    },
    template,
    context.config.secret
  );

  const channels: NoticeChannel[] = [];
  const devices =
    options.channel === 'email' || context.config.pushAvailable === false
      ? []
      : (await db.device_tokens.findMany({ select: { id: true, token: true }, where: { user_id: target.id, active: true }, take: 10 }))
          .records;

  for (const device of devices) {
    const result = await context.transport.push({ token: device.token, title: rendered.subject, body: PUSH_BODY, url: rendered.url });

    if (result.status === 'accepted') {
      channels.push(NoticeChannel.Push);
    } else if (result.status === 'device_unregistered') {
      await db.device_tokens.updateOne({ where: { id: device.id }, data: { active: false, updated_at: new Date(now).toISOString() } });
    }
  }

  const wantsEmail = options.channel === 'both' || !channels.length;

  if (wantsEmail && !ownerPays && target.email) {
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
    payload: { ...payload, channels, ...(channels.length ? {} : { reason: 'no_channel' }) },
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
export async function followUpCharge(
  db: DbClient,
  context: NoticeContext,
  event: ChargeNotifyEvent,
  now = Date.now()
): Promise<SendResult> {
  const charge = await db.charges.findOne({
    select: { state: true, proof_state: true, silenced: true, billing_id: true },
    where: { id: event.chargeId }
  });

  if (!charge || charge.state !== ChargeState.Pending || charge.proof_state === StoredProofState.Pending) {
    return { channels: [] };
  }

  // Silenced between the push and this e-mail: the creditor's latest word wins.
  if (charge.silenced) {
    return { channels: [] };
  }

  const billing = await db.billings.findOne({ select: { settled: true }, where: { id: charge.billing_id } });

  if (billing?.settled) {
    return { channels: [] };
  }

  const already = (await EventRepository.list(db, event.chargeId, 'notice.sent')).some(
    (sent) =>
      sent.payload['template'] === event.template &&
      sent.payload['offsetDays'] === event.offsetDays &&
      (sent.payload['channels'] as string[] | undefined)?.includes(NoticeChannel.Email)
  );

  if (already) {
    return { channels: [] };
  }

  return sendChargeNotice(db, context, event.chargeId, event.template, now, { offsetDays: event.offsetDays, channel: 'email' });
}

/** Fired at charge creation (after the transaction): the first notice, with its follow-up rule. */
export async function announceCharges(db: DbClient, context: NoticeContext, chargeIds: string[], now = Date.now()): Promise<void> {
  for (const chargeId of chargeIds) {
    const charge = await db.charges.findOne({
      select: { payer: true, due_date: true, billing_id: true, silenced: true },
      where: { id: chargeId }
    });

    // The owner of a conta a pagar just typed it: only the scheduled reminders reach them.
    if (!charge || ChargeRepository.payer(charge) === ChargePayer.Owner) {
      continue;
    }

    // A silenced charge gets no hello; the manual reminder is still there.
    if (charge.silenced) {
      continue;
    }

    const billing = await db.billings.findOne({
      select: { timezone: true, reminders: true, settled: true },
      where: { id: charge.billing_id }
    });

    if (!billing) {
      continue;
    }

    // A registro has nobody to greet.
    if (billing.settled) {
      continue;
    }

    // A charge created ahead of its due day meets the debtor through the reminders, not on the day it was created.
    const due = shouldSendInitialNotice({
      dueDate: charge.due_date,
      now,
      timezone: billing.timezone,
      reminders: effectiveReminders(billing)
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
  const { records } = await db.charges.findMany({
    select: { id: true, billing_id: true, due_date: true, proof_state: true, silenced: true },
    where: { state: ChargeState.Pending, due_date: { gte: from, lte: to } }
  });
  const billings = new Map<string, { timezone: string; reminders?: string; settled?: boolean }>();

  let planned = 0;

  for (const charge of records) {
    if (charge.proof_state === StoredProofState.Pending) {
      continue;
    }

    if (charge.silenced) {
      continue;
    }

    let billing = billings.get(charge.billing_id);

    if (!billing) {
      const row = await db.billings.findOne({
        select: { timezone: true, reminders: true, settled: true },
        where: { id: charge.billing_id }
      });

      if (!row) {
        continue;
      }

      billing = row;
      billings.set(charge.billing_id, row);
    }

    if (billing.settled) {
      continue;
    }

    for (const reminder of effectiveReminders(billing)) {
      if (!reminder.enabled) {
        continue;
      }

      const at = instantAt(addCalendarDays(charge.due_date, reminder.offsetDays), REMINDER_HOUR, billing.timezone);

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
