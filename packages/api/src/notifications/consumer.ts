import type { DbClient } from '../database';
import type { NotificationDeliverySchema } from '../schemas/notification';
import { digest, type NotificationConfig } from './planner';
import { type RenderInputs, renderNotice } from './render';
import type { NotificationTransport, ReceiptResult, SendResult } from './transport';

const SELECT = {
  id: true,
  charge_id: true,
  event_id: true,
  recipient_key: true,
  recipient_user_id: true,
  device_id: true,
  device_token_hash: true,
  channel: true,
  template: true,
  state: true,
  render_inputs: true,
  body_hash: true,
  idempotency_key: true,
  attempts: true,
  available_at: true,
  lease_until: true,
  first_attempt_at: true,
  provider_id: true,
  reason: true,
  created_at: true,
  updated_at: true
} as const;

const DEDUP_WINDOW = 23 * 3600_000; // Strictly below both providers' 24h expiry.
const LEASE = 60_000;

/**
 * A queue message only counts its own redeliveries, and the cron always publishes a fresh one,
 * so the row's persisted counter is what caps the retries of a notice.
 */
export const MAX_SEND_ATTEMPTS = 5;

/** Ceiling for the exponential backoff written to `available_at`. */
const MAX_BACKOFF = 15 * 60_000;

const sqlNull = null as unknown as string | undefined;

export type DeliveryRequest = {
  deliveryId: string;
  attempt: number;
  maxAttempts: number;
};

/** Raised so the queue redelivers the message; the row already carries its own backoff. */
class TransientDeliveryError extends Error {
  constructor() {
    super('transient notification delivery');
  }
}

/**
 * Sends one delivery or observes one push receipt. Returns `skipped` when the row is gone,
 * already terminal, still leased or not yet due, and throws on a transient provider failure so
 * the queue redelivers it. A redelivery that arrives before `available_at` is skipped without
 * consuming an attempt: the retry ladder is the row's own `attempts`, never the message's.
 */
export async function processDelivery(
  db: DbClient,
  transport: NotificationTransport,
  config: NotificationConfig,
  input: DeliveryRequest,
  clock = Date.now
): Promise<'done' | 'skipped'> {
  const candidate = await db.notification_deliveries.findOne({
    select: { id: true, charge_id: true },
    where: { id: input.deliveryId }
  });

  if (!candidate) {
    console.info('Notification delivery missing', { deliveryId: input.deliveryId });
    return 'skipped';
  }

  let settledInClaim = false;

  const claim = await db.transaction(async (tx) => {
    const now = clock();
    const stamp = new Date(now).toISOString();

    const charge = await tx.charges.findOne({
      select: { state: true },
      where: { id: candidate.charge_id },
      lock: true
    });

    const row = await tx.notification_deliveries.findOne({
      select: SELECT,
      where: { id: candidate.id },
      lock: true
    });

    if (
      !row ||
      !['pending', 'sending', 'accepted'].includes(row.state) ||
      Date.parse(row.available_at) > now ||
      (row.lease_until && Date.parse(row.lease_until) > now)
    ) {
      return;
    }

    const mark = async (state: 'suppressed' | 'uncertain' | 'failed', reason: string) => {
      await tx.notification_deliveries.updateOne({
        where: { id: row.id },
        data: { state, reason, queued_at: sqlNull, updated_at: stamp }
      });

      settledInClaim = true;
    };

    const receipt = row.state === 'accepted' && row.channel === 'push';

    if (row.state === 'sending' && row.channel === 'push') {
      await mark('uncertain', 'push_acknowledgement_lost');
      return;
    }

    if (row.first_attempt_at && now - Date.parse(row.first_attempt_at) >= DEDUP_WINDOW) {
      await mark('uncertain', receipt ? 'receipt_window_expired' : 'provider_window_expired');
      return;
    }

    const inputs = JSON.parse(row.render_inputs) as RenderInputs;

    const link = await tx.public_links.findOne({
      select: {
        public_id: true,
        token_version: true,
        expires_at: true,
        revoked_at: true
      },
      where: { charge_id: row.charge_id }
    });

    // Receipt lookup does not send a capability, so continue observing even after revocation/payment.
    if (
      !receipt &&
      (!charge ||
        charge.state !== 'pending' ||
        !link ||
        link.revoked_at ||
        link.public_id !== inputs.publicId ||
        link.token_version !== inputs.version ||
        Math.floor(Date.parse(link.expires_at) / 1000) !== inputs.expires ||
        inputs.expires * 1000 <= now)
    ) {
      await mark('suppressed', 'charge_or_capability_inactive');
      return;
    }

    const device = row.device_id
      ? await tx.device_tokens.findOne({
          select: { token: true, active: true, user_id: true },
          where: { id: row.device_id }
        })
      : undefined;

    if (!receipt && row.channel === 'push' && (!device?.active || device.user_id !== row.recipient_user_id)) {
      await mark('failed', 'device_unregistered');
      await fallback(tx, row.event_id, now);
      return;
    }

    if (!receipt && row.device_token_hash && device && digest(device.token) !== row.device_token_hash) {
      await mark('suppressed', 'device_changed');
      return;
    }

    // Persist before submission; receipt observation must never overwrite this with a rotated token.
    const tokenHash = row.device_token_hash ?? (!receipt && device ? digest(device.token) : undefined);
    const rendered = renderNotice(inputs, row.template, config.secret);

    if (!receipt && digest(JSON.stringify(rendered)) !== row.body_hash) {
      await mark('suppressed', 'render_configuration_changed');
      return;
    }

    if (!receipt && row.attempts >= MAX_SEND_ATTEMPTS) {
      await mark('failed', 'retry_exhausted');
      return;
    }

    const lease = new Date(now + LEASE).toISOString();
    const attempts = receipt ? row.attempts : row.attempts + 1;

    await tx.notification_deliveries.updateOne({
      where: { id: row.id },
      data: {
        state: receipt ? 'accepted' : 'sending',
        lease_until: lease,
        available_at: lease,
        attempts,
        first_attempt_at: row.first_attempt_at ?? stamp,
        ...(tokenHash ? { device_token_hash: tokenHash } : {}),
        updated_at: stamp
      }
    });

    return { row, receipt, inputs, rendered, token: device?.token, lease, attempts };
  });

  if (!claim) {
    return settledInClaim ? 'done' : 'skipped';
  }

  let result: SendResult | ReceiptResult;

  try {
    result = claim.receipt
      ? await transport.receipt(claim.row.provider_id!)
      : claim.row.channel === 'push'
        ? await transport.push({
            token: claim.token!,
            title: claim.rendered.subject,
            body: 'Confira os detalhes da cobrança no Receivy.',
            url: claim.rendered.url
          })
        : await transport.email({
            to: claim.inputs.email!,
            key: claim.row.idempotency_key,
            subject: claim.rendered.subject,
            text: claim.rendered.text,
            from: claim.inputs.from
          });
  } catch {
    result = { status: claim.receipt ? 'transient' : 'uncertain' };
  }

  const transient = result.status === 'transient';

  await db.transaction(async (tx) => {
    await tx.charges.findOne({
      select: { id: true },
      where: { id: claim.row.charge_id },
      lock: true
    });

    const row = await tx.notification_deliveries.findOne({
      select: SELECT,
      where: { id: claim.row.id },
      lock: true
    });

    if (!row || row.lease_until !== claim.lease || row.state !== (claim.receipt ? 'accepted' : 'sending')) {
      return;
    }

    const now = clock();
    const stamp = new Date(now).toISOString();

    let state: NotificationDeliverySchema['state'];
    let reason: string = result.status;
    let available = now;

    if (result.status === 'accepted') {
      state = 'accepted';
      available = now + 15 * 60_000;
      reason = row.channel === 'push' ? 'awaiting_receipt' : 'provider_accepted';
    } else if (result.status === 'delivered') {
      state = 'delivered';
      reason = 'push_service_receipt_ok';
    } else if (result.status === 'observation_failed') {
      state = 'uncertain';
      reason = 'receipt_observation_failed';
    } else if (result.status === 'disabled') {
      state = 'disabled';
    } else if (result.status === 'permanent' || result.status === 'device_unregistered') {
      state = 'failed';
    } else if (claim.receipt) {
      state = 'accepted';
      available = now + 15 * 60_000;
    } else if (result.status === 'uncertain' && row.channel === 'push') {
      state = 'uncertain';
    } else if (claim.attempts >= MAX_SEND_ATTEMPTS || input.attempt >= input.maxAttempts) {
      state = result.status === 'uncertain' ? 'uncertain' : 'failed';
      reason = 'retry_exhausted';
    } else {
      state = 'pending';
      available = now + Math.min(60_000 * 2 ** (claim.attempts - 1), MAX_BACKOFF);
    }

    // Every settlement releases the row from the queue, including a retry going back to `pending`:
    // the redelivery that follows the throw below arrives before `available_at` and is skipped, so
    // only the cron republishes the row, and it does so on the first pass after the backoff is due
    // (`queued_at IS NULL` branch) instead of waiting out the fifteen-minute staleness rule.
    // Clearing it here is the single place that owns this; the claim guard just skips and returns.

    await tx.notification_deliveries.updateOne({
      where: { id: row.id },
      data: {
        state,
        reason,
        available_at: new Date(available).toISOString(),
        lease_until: stamp,
        queued_at: sqlNull,
        ...(result.status === 'accepted' ? { provider_id: result.id } : {}),
        updated_at: stamp
      }
    });

    if (result.status === 'device_unregistered' && row.device_id && row.device_token_hash) {
      const current = await tx.device_tokens.findOne({
        select: { token: true },
        where: { id: row.device_id },
        lock: true
      });

      if (current && digest(current.token) === row.device_token_hash) {
        await tx.device_tokens.updateOne({
          where: { id: row.device_id },
          data: { active: false, updated_at: stamp }
        });
      }
    }

    if (state === 'failed' && row.channel === 'push') {
      await fallback(tx, row.event_id, now);
    }
  });

  if (transient) {
    throw new TransientDeliveryError();
  }

  return 'done';
}

/** Caller holds the charge lock. A pending/accepted/uncertain/successful sibling forbids fallback. */
async function fallback(db: DbClient, eventId: string, now: number) {
  const rows = (
    await db.notification_deliveries.findMany({
      select: SELECT,
      where: { event_id: eventId }
    })
  ).records;

  if (rows.some((row) => row.channel === 'push' && row.state !== 'failed')) {
    return;
  }

  const stamp = new Date(now).toISOString();
  const email = rows.find((row) => row.channel === 'email');

  if (email) {
    // The follow-up was already planned; pull it forward instead of duplicating it.
    // A follow-up already submitted once is inside its own provider backoff, which outranks this.
    if (email.state === 'pending' && !email.first_attempt_at && Date.parse(email.available_at) > now) {
      await db.notification_deliveries.updateOne({
        where: { id: email.id },
        data: {
          available_at: stamp,
          reason: 'push_failed_fallback',
          updated_at: stamp
        }
      });
    }

    return;
  }

  // Only reachable for notices planned before the follow-up row existed; new plans always carry one.
  const first = rows[0];

  if (!first) {
    return;
  }

  const input = JSON.parse(first.render_inputs) as RenderInputs;

  if (!input.email) {
    return;
  }

  await db.notification_deliveries.insertOne({
    data: {
      id: crypto.randomUUID(),
      event_id: eventId,
      charge_id: first.charge_id,
      recipient_key: input.email,
      recipient_user_id: first.recipient_user_id,
      channel: 'email',
      template: first.template,
      state: 'pending',
      reason: 'push_failed_fallback',
      render_inputs: first.render_inputs,
      body_hash: first.body_hash,
      idempotency_key: digest(`${eventId}/email/${input.email}`),
      attempts: 0,
      available_at: stamp,
      created_at: stamp,
      updated_at: stamp
    }
  });
}
