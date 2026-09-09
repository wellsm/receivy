import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpConflictError, HttpForbiddenError } from '@ez4/gateway';
import { QueueTester } from '@ez4/local-queue/test';
import { createBilling } from '../../src/billings/repository';
import { createEmailClient } from '../../src/email/compose';
import { processDelivery } from '../../src/notifications/consumer';
import { enqueueDueDeliveries, planDueReminders } from '../../src/notifications/cron';
import { EMAIL_FOLLOWUP_MS, type NoticeContext, QUEUE_STALE_MS } from '../../src/notifications/planner';
import type { NotificationMessage, NotificationQueue } from '../../src/notifications/queue';
import { deliverNotification } from '../../src/notifications/queue';
import { listDeliveries, manualReminder, registerDevice } from '../../src/notifications/repository';
import type { NotificationTransport } from '../../src/notifications/transport';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { savePerson } from '../../src/people/repository';
import { createOrRotatePublicLink, revokePublicLink } from '../../src/public/repository';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'b1111111-1111-4111-8111-111111111111';
const DEBTOR = 'b2222222-2222-4222-8222-222222222222';
const OTHER = 'b3333333-3333-4333-8333-333333333333';
const NOPIX = 'b4444444-4444-4444-8444-444444444444';

const DEBTOR_EMAIL = 'notify-debtor@example.com';
const DUE_DATE = '2029-01-04';
const start = Date.parse('2029-01-01T12:00:00Z');
const REMINDER_INSTANT = Date.parse('2029-01-04T12:00:00Z');

const config = {
  publicOrigin: 'https://receivy.example',
  secret: 'notification-test-secret-with-enough-entropy',
  from: 'fixture@example.invalid'
};

type QueueMock = QueueTester.ClientMock<NotificationMessage, { fairMode: true }>;

QueueTester.setClientMock<NotificationQueue>('NotificationQueue');

const queue = QueueTester.getClient<NotificationQueue>('NotificationQueue') as unknown as QueueMock;
const notice: NoticeContext = { config, queue };

let clock = start;
let count = 0;

const emails: { to: string; key: string; text: string }[] = [];

const transport: NotificationTransport = {
  email: async (input) => {
    emails.push(input);
    return { status: 'accepted', id: 'email-test' };
  },
  push: async () => ({ status: 'accepted', id: 'ticket-test' }),
  receipt: async () => ({ status: 'delivered' })
};

function queued(): string[] {
  return queue.sendMessage.mock.calls.map((call) => (call.arguments[0] as NotificationMessage).deliveryId);
}

function forget() {
  queue.sendMessage.mock.resetCalls();
}

const people = new Map<string, string>();

async function person(owner: string, name: string, email: string) {
  const key = `${owner}:${email}`;
  const known = people.get(key);

  if (known) {
    return known;
  }

  const created = await savePerson(db, owner, { name, email });

  people.set(key, created.id);

  return created.id;
}

async function charge(owner = OWNER, email?: string) {
  count++;

  const address = email ?? `notify-${count}@example.com`;
  const personId = await person(owner, `Recipient ${count}`, address);

  const billing = await createBilling(
    db,
    owner,
    `notify-${count}`,
    {
      type: 'once',
      totalCents: 1234,
      startDate: DUE_DATE,
      timezone: 'America/Sao_Paulo',
      split: { mode: 'fixed', parts: [{ kind: 'person', personId, amountCents: 1234 }] }
    },
    new Date(clock),
    undefined,
    notice
  );

  return { id: billing.charges[0]!.id, address, personId };
}

async function rows(chargeId: string) {
  const found = await db.notification_deliveries.findMany({
    select: {
      id: true,
      channel: true,
      template: true,
      state: true,
      reason: true,
      attempts: true,
      available_at: true,
      queued_at: true,
      provider_id: true,
      event_id: true
    },
    where: { charge_id: chargeId }
  });

  return found.records;
}

/** Notices fan out to every active device, so each push case starts from a single registration. */
async function soleDevice(token: string, installationId: string) {
  await db.device_tokens.updateMany({ where: { user_id: DEBTOR }, data: { active: false } });

  return registerDevice(db, DEBTOR, { token, platform: 'ios', installationId });
}

function deliver(deliveryId: string, sender: NotificationTransport = transport, attempt = 1) {
  return processDelivery(db, sender, config, { deliveryId, attempt, maxAttempts: 5 }, () => clock);
}

const incoming = (deliveryId: string, attempt = 1) => ({
  requestId: 'notification-spec',
  traceId: 'notification-trace',
  attempt,
  maxAttempts: 5,
  message: { deliveryId },
  retry: async () => {}
});

describe('queued notification delivery', () => {
  before(async () => {
    const [row] = await db.rawQuery('SELECT current_database() AS name');

    equal(row?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'notify-owner@example.com', name: 'Owner' });
    await savePaymentMethod(db, OWNER, { pixKeyType: 'email', pixKey: 'notify-owner@example.com' });
    await createUser(db, { id: DEBTOR, email: DEBTOR_EMAIL, name: 'Debtor' });
    await createUser(db, { id: OTHER, email: 'notify-other@example.com', name: 'Other' });
    await createUser(db, { id: NOPIX, email: 'notify-nopix@example.com', name: 'No Pix' });
  });

  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER, NOPIX]));

  it('plans a push now plus the e-mail follow-up and enqueues only the due row', async () => {
    clock = start;
    forget();

    await soleDevice('ExpoPushToken[plan-initial]', 'plan-initial');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);
    const planned = await rows(id);

    equal(planned.length, 2, 'one push plus the deferred e-mail follow-up');

    const push = planned.find((row) => row.channel === 'push')!;
    const followup = planned.find((row) => row.channel === 'email')!;

    equal(push.state, 'pending');
    equal(push.template, 'initial');
    equal(push.event_id, `charge:${id}:initial`);
    equal(Date.parse(push.available_at), clock);

    equal(followup.state, 'pending');
    equal(followup.reason, 'push_followup');
    equal(Date.parse(followup.available_at), clock + EMAIL_FOLLOWUP_MS);

    const messages = queued();

    ok(messages.includes(push.id), 'the due push is published to the queue');
    ok(!messages.includes(followup.id), 'the deferred follow-up is not published yet');

    const stamped = await db.notification_deliveries.findOne({ select: { queued_at: true }, where: { id: push.id } });

    equal(Date.parse(stamped!.queued_at!), clock);
  });

  it('e-mails immediately when the recipient has no active device', async () => {
    clock = start;
    forget();

    const { id } = await charge();
    const planned = await rows(id);

    equal(planned.length, 1);
    equal(planned[0]!.channel, 'email');
    equal(planned[0]!.state, 'pending');
    ok(!planned[0]!.reason, 'no follow-up reason without a push sibling');
    equal(Date.parse(planned[0]!.available_at), clock);
    ok(queued().includes(planned[0]!.id));
  });

  it('plans a manual reminder, enqueues it and refuses another one inside twenty-four hours', async () => {
    clock = start;

    const { id } = await charge();

    await rejects(() => manualReminder(db, OTHER, id, notice, () => clock), HttpForbiddenError);

    forget();

    equal((await manualReminder(db, OWNER, id, notice, () => clock)).queued, true);

    const manual = (await rows(id)).filter((row) => row.template === 'manual');

    equal(manual.length, 1);
    equal(manual[0]!.state, 'pending');
    ok(manual[0]!.event_id.startsWith(`charge:${id}:manual:`));
    ok(queued().includes(manual[0]!.id));

    await rejects(
      () => manualReminder(db, OWNER, id, notice, () => clock),
      (error: Error & { status?: number }) => error.status === 429
    );

    clock += 24 * 3600_000 + 1;

    equal((await manualReminder(db, OWNER, id, notice, () => clock)).queued, true);
    equal((await rows(id)).filter((row) => row.template === 'manual').length, 2);
  });

  it('serializes concurrent manual reminders so only one wins the quota', async () => {
    clock = start;

    const { id } = await charge();

    const results = await Promise.allSettled([
      manualReminder(db, OWNER, id, notice, () => clock),
      manualReminder(db, OWNER, id, notice, () => clock)
    ]);

    equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  });

  it('resumes the notice suppressed by a missing Pix when the charge is published', async () => {
    clock = start;

    const { id } = await charge(NOPIX);
    const suppressed = await rows(id);

    equal(suppressed.length, 1);
    equal(suppressed[0]!.state, 'suppressed');
    equal(suppressed[0]!.reason, 'pix_required');
    equal(await db.public_links.count({ where: { charge_id: id } }), 0);

    const method = await savePaymentMethod(db, NOPIX, { pixKeyType: 'email', pixKey: 'notify-nopix@example.com' });

    forget();

    await createOrRotatePublicLink(db, NOPIX, id, config.secret, false, Math.floor(clock / 1000), method.id, notice);

    const resumed = await rows(id);

    equal(resumed.length, 1, 'the suppressed row is replanned in place, never duplicated');
    equal(resumed[0]!.id, suppressed[0]!.id);
    equal(resumed[0]!.state, 'pending');
    ok(!resumed[0]!.reason);
    ok(queued().includes(resumed[0]!.id));
  });

  it('holds reminders until 09:00 in the billing timezone, then plans and enqueues them once', async () => {
    clock = start;

    const { id } = await charge();

    clock = Date.parse('2029-01-04T11:40:00Z');

    equal(await planDueReminders(db, config, clock), 0, 'nothing is planned before 09:00 local');
    equal((await rows(id)).filter((row) => row.template === 'reminder').length, 0);

    clock = REMINDER_INSTANT;
    forget();

    ok((await planDueReminders(db, config, clock)) > 0);

    const reminders = (await rows(id)).filter((row) => row.template === 'reminder');

    equal(reminders.length, 1, 'the due-date default plans exactly one reminder');
    equal(reminders[0]!.event_id, `charge:${id}:reminder:2029-01-04:0`);
    equal(reminders[0]!.state, 'pending');

    await planDueReminders(db, config, clock);

    equal((await rows(id)).filter((row) => row.template === 'reminder').length, 1, 'a repeated cron pass is inert');

    await enqueueDueDeliveries(db, queue, clock);

    ok(queued().includes(reminders[0]!.id));
  });

  it('enqueues the follow-up only when it comes due and re-enqueues a lost message after fifteen minutes', async () => {
    clock = start;

    await soleDevice('ExpoPushToken[followup-window]', 'followup-window');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);
    const planned = await rows(id);
    const followup = planned.find((row) => row.channel === 'email')!;
    const push = planned.find((row) => row.channel === 'push')!;

    clock = start + 10 * 60_000;
    forget();

    await enqueueDueDeliveries(db, queue, clock);

    ok(!queued().includes(followup.id), 'the follow-up waits the full two hours');
    ok(!queued().includes(push.id), 'a freshly queued message is left to its consumer');

    clock = start + EMAIL_FOLLOWUP_MS;
    forget();

    await enqueueDueDeliveries(db, queue, clock);

    ok(queued().includes(followup.id));

    // The push message never reached a consumer: its `queued_at` is now stale.
    ok(queued().includes(push.id), 'a message lost for more than fifteen minutes is published again');

    await db.notification_deliveries.updateOne({
      where: { id: push.id },
      data: { queued_at: new Date(clock - QUEUE_STALE_MS + 60_000).toISOString() }
    });

    forget();

    await enqueueDueDeliveries(db, queue, clock);

    ok(!queued().includes(push.id), 'a message queued moments ago is not published twice');
  });

  it('writes the exponential backoff and rethrows so the queue redelivers a transient failure', async () => {
    clock = start;

    const { id } = await charge();
    const [row] = await rows(id);

    const failing: NotificationTransport = { ...transport, email: async () => ({ status: 'transient' }) };

    await rejects(() => deliver(row!.id, failing));

    const first = (await rows(id))[0]!;

    equal(first.state, 'pending');
    equal(first.reason, 'transient');
    equal(first.attempts, 1);
    equal(Date.parse(first.available_at), clock + 60_000);
    ok(!first.queued_at, 'the backed-off row leaves the queue so the cron can republish it');

    // A redelivery that beats the backoff must not consume an attempt.
    equal(await deliver(row!.id, failing), 'skipped');
    equal((await rows(id))[0]!.attempts, 1);

    clock += 60_000;

    await rejects(() => deliver(row!.id, failing));

    const second = (await rows(id))[0]!;

    equal(second.attempts, 2, 'the row counter escalates, never the message attempt');
    equal(Date.parse(second.available_at), clock + 120_000);
  });

  it('republishes a backed-off notice as soon as the backoff is due, not after the staleness window', async () => {
    clock = start;

    const { id } = await charge();
    const [row] = await rows(id);

    const failing: NotificationTransport = { ...transport, email: async () => ({ status: 'transient' }) };

    await rejects(() => deliver(row!.id, failing));

    const backed = (await rows(id))[0]!;

    equal(backed.state, 'pending');
    equal(Date.parse(backed.available_at), clock + 60_000);
    ok(!backed.queued_at, 'the retry is no longer in flight');

    forget();

    // The queue redelivers within seconds: the claim guard drops it without consuming an attempt.
    equal(await deliver(row!.id, failing), 'skipped');

    await enqueueDueDeliveries(db, queue, clock);

    ok(!queued().includes(row!.id), 'the cron waits for the backoff');

    clock += 60_000;
    forget();

    await enqueueDueDeliveries(db, queue, clock);

    ok(queued().includes(row!.id), 'the first cron pass after the backoff publishes it again');

    const republished = (await rows(id))[0]!;

    equal(republished.attempts, 1, 'republishing never consumes an attempt');
    ok(republished.queued_at, 'the fresh message stamps the row again');
  });

  it('persists the attempt count when a retried e-mail finally goes out', async () => {
    clock = start;

    const { id, address } = await charge();
    const [row] = await rows(id);

    await rejects(() => deliver(row!.id, { ...transport, email: async () => ({ status: 'transient' }) }));

    clock += 60_000;

    const before = emails.filter((entry) => entry.to === address).length;

    equal(await deliver(row!.id), 'done');

    const accepted = (await rows(id))[0]!;

    equal(accepted.state, 'accepted');
    equal(accepted.attempts, 2);
    equal(emails.filter((entry) => entry.to === address).length, before + 1);
  });

  it('caps the retries at five real sends and then dead-letters the notice', async () => {
    clock = start;

    const { id } = await charge();
    const [row] = await rows(id);

    let sends = 0;
    const failing: NotificationTransport = {
      ...transport,
      email: async () => {
        sends++;
        return { status: 'transient' };
      }
    };

    for (const backoff of [60_000, 120_000, 240_000, 480_000]) {
      await rejects(() => deliver(row!.id, failing));

      clock += backoff;
    }

    equal(sends, 4);

    await rejects(() => deliver(row!.id, failing));

    const exhausted = (await rows(id))[0]!;

    equal(sends, 5, 'the transport is called exactly five times');
    equal(exhausted.state, 'failed');
    equal(exhausted.reason, 'retry_exhausted');
    equal(exhausted.attempts, 5);
    ok(!exhausted.queued_at, 'a settled row leaves the queue');

    clock += 3600_000;

    equal(await deliver(row!.id, failing), 'skipped');
    equal(sends, 5, 'a dead-lettered notice is never submitted again');
    equal((await db.charges.findOne({ select: { state: true }, where: { id } }))?.state, 'pending');
  });

  it('dead-letters a row left pending with its attempts spent, without calling the transport', async () => {
    clock = start;

    const { id } = await charge();
    const [row] = await rows(id);

    // A run that crashed after the claim leaves the row pending with the attempts already spent.
    await db.notification_deliveries.updateOne({
      where: { id: row!.id },
      data: { attempts: 5, available_at: new Date(clock).toISOString(), lease_until: new Date(clock - 1).toISOString() }
    });

    let sends = 0;

    equal(
      await deliver(row!.id, {
        ...transport,
        email: async () => {
          sends++;
          return { status: 'accepted', id: 'must-not-send' };
        }
      }),
      'done'
    );

    equal(sends, 0);

    const exhausted = (await rows(id))[0]!;

    equal(exhausted.state, 'failed');
    equal(exhausted.reason, 'retry_exhausted');
  });

  it('turns an accepted ticket into a delivered receipt and stops there', async () => {
    clock = start;

    await soleDevice('ExpoPushToken[receipt-delivered]', 'receipt-delivered');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);
    const push = (await rows(id)).find((row) => row.channel === 'push')!;

    equal(await deliver(push.id), 'done');

    const accepted = (await rows(id)).find((row) => row.id === push.id)!;

    equal(accepted.state, 'accepted');
    equal(accepted.reason, 'awaiting_receipt');
    equal(accepted.provider_id, 'ticket-test');
    equal(Date.parse(accepted.available_at), clock + 15 * 60_000);

    equal(await deliver(push.id), 'skipped', 'the receipt is not observed before its window');

    clock += 15 * 60_000;

    equal(await deliver(push.id), 'done');

    const delivered = (await rows(id)).find((row) => row.id === push.id)!;

    equal(delivered.state, 'delivered');
    equal(delivered.reason, 'push_service_receipt_ok');
    ok(!delivered.queued_at);
  });

  it('advances the planned follow-up when the push fails definitively and deactivates the token', async () => {
    clock = start;

    const device = await soleDevice('ExpoPushToken[fallback-unregistered]', 'fallback-unregistered');

    const { id, address } = await charge(OWNER, DEBTOR_EMAIL);
    const push = (await rows(id)).find((row) => row.channel === 'push')!;

    await deliver(push.id, { ...transport, push: async () => ({ status: 'device_unregistered' }) });

    const advanced = (await rows(id)).filter((row) => row.channel === 'email');

    equal(advanced.length, 1, 'the follow-up row is reused, never duplicated');
    equal(advanced[0]!.state, 'pending');
    equal(advanced[0]!.reason, 'push_failed_fallback');
    ok(Date.parse(advanced[0]!.available_at) <= clock);

    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: device.id } }))?.active, false);

    const sent = emails.filter((entry) => entry.to === address).length;

    await deliver(advanced[0]!.id);

    equal(emails.filter((entry) => entry.to === address).length, sent + 1);
    equal((await rows(id)).filter((row) => row.channel === 'email').length, 1);
  });

  it('never resends an uncertain push nor falls back beside it', async () => {
    clock = start;

    await soleDevice('ExpoPushToken[uncertain-sibling]', 'uncertain-sibling');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);
    const push = (await rows(id)).find((row) => row.channel === 'push')!;

    let pushes = 0;

    await deliver(push.id, {
      ...transport,
      push: async () => {
        pushes++;
        throw new Error('accepted but response lost');
      }
    });

    equal(pushes, 1);

    const uncertain = (await rows(id)).find((row) => row.id === push.id)!;

    equal(uncertain.state, 'uncertain');

    clock += 60_001;

    equal(await deliver(push.id, { ...transport, push: async () => ({ status: 'accepted', id: 'must-not-send' }) }), 'skipped');
    equal(pushes, 1);

    const waiting = (await rows(id)).filter((row) => row.channel === 'email');

    equal(waiting.length, 1, 'no fallback e-mail is added beside an uncertain sibling');
    equal(waiting[0]!.reason, 'push_followup');
    equal(Date.parse(waiting[0]!.available_at), start + EMAIL_FOLLOWUP_MS);
  });

  it('suppresses a pending push when the registration rotates and keeps the new token active', async () => {
    clock = start;

    const input = {
      token: 'ExpoPushToken[rotation-old]',
      platform: 'ios' as const,
      installationId: 'rotation-device'
    };

    const device = await soleDevice(input.token, input.installationId);
    const { id } = await charge(OWNER, DEBTOR_EMAIL);
    const push = (await rows(id)).find((row) => row.channel === 'push')!;

    const rotated = await registerDevice(db, DEBTOR, { ...input, token: 'ExpoPushToken[rotation-new]' });

    equal(rotated.id, device.id);

    const suppressed = (await rows(id)).find((row) => row.id === push.id)!;

    equal(suppressed.state, 'suppressed');
    equal(suppressed.reason, 'device_changed');
    equal(await deliver(push.id), 'skipped', 'a suppressed row is never submitted');

    const current = await db.device_tokens.findOne({ select: { token: true, active: true }, where: { id: device.id } });

    equal(current?.token, 'ExpoPushToken[rotation-new]');
    equal(current?.active, true);
  });

  it('does not deactivate a rotated token when the old accepted ticket reports DeviceNotRegistered', async () => {
    clock = start;

    const input = {
      token: 'ExpoPushToken[receipt-rotation-old]',
      platform: 'ios' as const,
      installationId: 'receipt-rotation'
    };

    const device = await soleDevice(input.token, input.installationId);
    const { id } = await charge(OWNER, DEBTOR_EMAIL);
    const push = (await rows(id)).find((row) => row.channel === 'push')!;

    await deliver(push.id);

    equal((await rows(id)).find((row) => row.id === push.id)?.state, 'accepted');

    await registerDevice(db, DEBTOR, { ...input, token: 'ExpoPushToken[receipt-rotation-new]' });

    clock += 15 * 60_000;

    await deliver(push.id, { ...transport, receipt: async () => ({ status: 'device_unregistered' }) });

    const current = await db.device_tokens.findOne({ select: { token: true, active: true }, where: { id: device.id } });

    equal(current?.token, 'ExpoPushToken[receipt-rotation-new]');
    equal(current?.active, true);
    equal((await rows(id)).find((row) => row.id === push.id)?.state, 'failed');
  });

  it('refuses an e-mail retry beyond the safe provider window', async () => {
    clock = start;

    const { id, address } = await charge();
    const [row] = await rows(id);

    await rejects(() => deliver(row!.id, { ...transport, email: async () => ({ status: 'transient' }) }, 1));

    clock += 23 * 3600_000;

    const sent = emails.filter((entry) => entry.to === address).length;

    equal(await deliver(row!.id, transport, 2), 'done');
    equal(emails.filter((entry) => entry.to === address).length, sent);

    const expired = (await rows(id))[0]!;

    equal(expired.state, 'uncertain');
    equal(expired.reason, 'provider_window_expired');
  });

  it('suppresses a delivery whose capability was revoked or whose charge closed', async () => {
    clock = start;

    const { id } = await charge();
    const [row] = await rows(id);

    await revokePublicLink(db, OWNER, id);

    equal(await deliver(row!.id), 'done');

    const suppressed = (await rows(id))[0]!;

    equal(suppressed.state, 'suppressed');
    equal(suppressed.reason, 'charge_or_capability_inactive');
    ok(!suppressed.queued_at);
  });

  it('returns without effect when the message names a delivery that no longer exists', async () => {
    clock = start;

    equal(await deliver(crypto.randomUUID()), 'skipped');
  });

  it('runs the configured queue handler and records an explicitly disabled provider', async () => {
    clock = start;

    const { id } = await charge();
    const [row] = await rows(id);

    // The handler runs on the real clock, so the planned row has to be due right now.
    await db.notification_deliveries.updateOne({
      where: { id: row!.id },
      data: { available_at: new Date().toISOString() }
    });

    const context: Parameters<typeof deliverNotification>[1] = {
      db,
      email: createEmailClient({ APP_STAGE: 'test', RESEND_API_KEY: 'disabled' }),
      variables: {
        APP_STAGE: 'test',
        NOTIFICATION_EMAIL_TRANSPORT: 'disabled',
        NOTIFICATION_PUSH_TRANSPORT: 'disabled',
        EXPO_ACCESS_TOKEN: 'disabled',
        RESEND_API_KEY: 'disabled',
        RESEND_FROM_EMAIL: config.from,
        PUBLIC_WEB_ORIGIN: config.publicOrigin,
        PUBLIC_LINK_HMAC_SECRET: config.secret
      }
    };

    await deliverNotification(incoming(row!.id), context);

    ok((await listDeliveries(db, OWNER, id)).every((delivery) => delivery.state === 'disabled'));
    await rejects(() => listDeliveries(db, OTHER, id), HttpForbiddenError);
  });

  it('refuses to move a device between accounts while its notices are queued', async () => {
    const input = {
      token: 'ExpoPushToken[account-transfer]',
      platform: 'ios' as const,
      installationId: 'account-transfer'
    };

    await registerDevice(db, DEBTOR, input);
    await rejects(() => registerDevice(db, OTHER, input), HttpConflictError);
  });
});
