import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpConflictError, HttpForbiddenError } from '@ez4/gateway';
import { disableSessionDevices } from '../../src/account/sessions';
import { createBilling } from '../../src/billings/repository';
import { cancelCharge } from '../../src/charges/repository';
import { createEmailClient } from '../../src/email/compose';
import { expandOutbox } from '../../src/notifications/outbox';
import { listDeliveries, manualReminder, registerDevice } from '../../src/notifications/repository';
import { notificationJobHandler } from '../../src/notifications/scheduler';
import type { NotificationTransport } from '../../src/notifications/transport';
import { notificationTransport } from '../../src/notifications/transport';
import { runNotifications } from '../../src/notifications/worker';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { savePerson } from '../../src/people/repository';
import { createOrRotatePublicLink, revokePublicLink } from '../../src/public/repository';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const OWNER = 'b1111111-1111-4111-8111-111111111111';
const DEBTOR = 'b2222222-2222-4222-8222-222222222222';
const OTHER = 'b3333333-3333-4333-8333-333333333333';
const start = Date.parse('2027-01-01T12:00:00Z');
const config = {
  publicOrigin: 'https://receivy.example',
  secret: 'notification-test-secret-with-enough-entropy'
};
let clock = start;
let count = 0;
let personId: string;
const emails: { to: string; key: string; text: string }[] = [];
const extraUsers: string[] = [];
async function recipient() {
  const id = crypto.randomUUID();
  extraUsers.push(id);
  await createUser(db, {
    id,
    email: `${id}@example.com`,
    name: 'Device fixture'
  });
  return id;
}
const transport: NotificationTransport = {
  email: async (input) => {
    emails.push(input);
    return { status: 'accepted', id: 'email-test' };
  },
  push: async () => ({ status: 'accepted', id: 'ticket-test' }),
  receipt: async () => ({ status: 'delivered' })
};
async function charge() {
  personId = (
    await savePerson(db, OWNER, {
      name: `Recipient ${++count}`,
      email: `notify-${count}@example.com`
    })
  ).id;
  return (await createOnceCharge(db, OWNER, `notify-${count}`, { personId, amountCents: 1234, dueDate: '2027-01-04' })).chargeId;
}
const run = (sender = transport) => runNotifications(db, sender, config, () => clock);
describe('durable notification delivery', () => {
  before(async () => {
    const [row] = await db.rawQuery('SELECT current_database() AS name');
    equal(row?.['name'], 'receivy_tests');
    await createUser(db, {
      id: OWNER,
      email: 'notify-owner@example.com',
      name: 'Owner'
    });
    await savePaymentMethod(db, OWNER, { pixKeyType: 'email', pixKey: 'notify-owner@example.com' });
    await createUser(db, {
      id: DEBTOR,
      email: 'notify-debtor@example.com',
      name: 'Debtor'
    });
    await createUser(db, {
      id: OTHER,
      email: 'notify-other@example.com',
      name: 'Other'
    });
  });
  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER, ...extraUsers]));
  it('consumes legacy minimal events once and never redirects old debt to edited contacts', async () => {
    const id = await charge();
    const original = `notify-${count}@example.com`;
    await db.outbox_events.updateMany({
      where: { aggregate_id: id, type: 'charge.created' },
      data: { payload: JSON.stringify({ chargeId: id, source: 'expense' }) }
    });
    await savePerson(db, OWNER, { name: 'Edited', email: 'redirect@example.com' }, personId);
    await Promise.all([run(), run()]);
    equal(emails.filter((e) => e.to === original).length, 1, 'only the initial notice fires today');
    equal(emails.filter((e) => e.to === 'redirect@example.com').length, 0);
    const rows = await listDeliveries(db, OWNER, id);
    equal(rows.length, 1);
    ok(rows.every((row) => row.state === 'accepted'));
    await rejects(() => listDeliveries(db, OTHER, id), HttpForbiddenError);
    const pending = await db.outbox_events.count({
      where: { aggregate_id: id, type: 'charge.reminder', state: 'pending' }
    });
    equal(pending, 1, 'the due-date reminder stays queued for the due date');
  });
  it('keeps disabled delivery observable without undoing the charge', async () => {
    const id = await charge();
    await run({ ...transport, email: async () => ({ status: 'disabled' }) });
    ok((await listDeliveries(db, OWNER, id)).every((row) => row.state === 'disabled'));
    equal((await db.charges.findOne({ select: { state: true }, where: { id } }))?.state, 'pending');
  });
  it('retries email with identical body/key and bounded backoff, suppressing revoked capabilities', async () => {
    const id = await charge();
    const attempted: { to: string; key: string; text: string }[] = [];
    await run({
      ...transport,
      email: async (input) => {
        attempted.push(input);
        return { status: 'uncertain' };
      }
    });
    const beforeRetry = attempted.length;
    await run();
    equal(attempted.length, beforeRetry);
    clock += 61_000;
    await run({
      ...transport,
      email: async (input) => {
        attempted.push(input);
        return { status: 'accepted', id: 'retry' };
      }
    });
    equal(attempted[0]?.key, attempted[beforeRetry]?.key);
    equal(attempted[0]?.text, attempted[beforeRetry]?.text);
    const revoked = await charge();
    await run({ ...transport, email: async () => ({ status: 'transient' }) });
    await revokePublicLink(db, OWNER, revoked);
    clock += 61_000;
    await run();
    ok((await listDeliveries(db, OWNER, revoked)).every((row) => row.state === 'suppressed'));
    await cancelCharge(db, OWNER, id);
    clock = Date.parse('2027-01-04T12:00:00Z');
    await run();
    ok((await listDeliveries(db, OWNER, id)).some((row) => row.state === 'suppressed'));
  });
  it('enforces ownership and concurrent manual quota', async () => {
    const id = await charge();
    await rejects(() => manualReminder(db, OTHER, id, () => clock), HttpForbiddenError);
    const results = await Promise.allSettled([manualReminder(db, OWNER, id, () => clock), manualReminder(db, OWNER, id, () => clock)]);
    equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  });
  it('persists Expo tickets, polls receipts, disables revoked tokens and falls back only on definite failure', async () => {
    clock = start;
    await registerDevice(db, DEBTOR, {
      token: 'ExpoPushToken[notification-receipts]',
      platform: 'android',
      installationId: 'receipt-device'
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: {
        recipient_user: { id: DEBTOR },
        recipient_email_snapshot: 'notify-debtor@example.com'
      }
    });
    let pushes = 0;
    let receipts = 0;
    const sender: NotificationTransport = {
      ...transport,
      push: async () => {
        pushes++;
        return { status: 'accepted', id: `ticket-${pushes}` };
      },
      receipt: async () => {
        receipts++;
        return { status: 'pending' };
      }
    };
    await run(sender);
    equal(pushes, 1);
    equal(receipts, 0);
    const planned = await listDeliveries(db, OWNER, id);

    equal(planned.filter((row) => row.channel === 'push' && row.state === 'accepted').length, 1);
    const followup = planned.find((row) => row.channel === 'email')!;

    equal(followup.state, 'pending');
    equal(followup.reason, 'push_followup');
    clock += 15 * 60_000;
    await run(sender);
    equal(pushes, 1);
    equal(receipts, 1);
    clock += 15 * 60_000;
    await run({
      ...sender,
      receipt: async () => ({ status: 'device_unregistered' })
    });
    await run();
    equal(pushes, 1);
    const rows = await listDeliveries(db, OWNER, id);
    const emailed = rows.filter((row) => row.channel === 'email');

    equal(emailed.length, 1, 'the planned follow-up is advanced, never duplicated');
    equal(emailed[0]!.id, followup.id);
    equal(emailed[0]!.state, 'accepted');
    equal(
      await db.device_tokens.count({
        where: { user_id: DEBTOR, active: true }
      }),
      0
    );
  });
  it('does not resend uncertain pushes, recover a stale sending lease, or fallback beside an uncertain sibling', async () => {
    clock = start;
    await registerDevice(db, DEBTOR, {
      token: 'ExpoPushToken[notification-uncertain]',
      platform: 'ios',
      installationId: 'uncertain-device'
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: {
        recipient_user: { id: DEBTOR },
        recipient_email_snapshot: 'notify-debtor@example.com'
      }
    });
    let pushes = 0;
    await run({
      ...transport,
      push: async () => {
        pushes++;
        throw new Error('accepted but response lost');
      }
    });
    const rows = await listDeliveries(db, OWNER, id);
    ok(rows.filter((row) => row.channel === 'push').every((row) => row.state === 'uncertain'));
    const first = rows.find((row) => row.channel === 'push')!;
    await db.notification_deliveries.updateOne({
      where: { id: first.id },
      data: {
        state: 'sending',
        lease_until: new Date(clock - 1).toISOString()
      }
    });
    clock += 60_001;
    await run({
      ...transport,
      push: async () => {
        pushes++;
        return { status: 'accepted', id: 'must-not-send' };
      }
    });
    equal(pushes, 1);
    const settled = (
      await db.notification_deliveries.findMany({
        select: { channel: true, state: true, reason: true, available_at: true },
        where: { charge_id: id }
      })
    ).records;

    ok(settled.filter((row) => row.channel === 'push').every((row) => row.state === 'uncertain'));
    const waiting = settled.filter((row) => row.channel === 'email');

    equal(waiting.length, 1, 'no fallback e-mail is added beside an uncertain sibling');
    equal(waiting[0]!.state, 'pending');
    equal(waiting[0]!.reason, 'push_followup');
    equal(Date.parse(waiting[0]!.available_at), start + 2 * 3600_000, 'the follow-up is not pulled forward');
  });
  it('retains unsupported events without blocking eligible events and exposes the unsupported backlog', async () => {
    const id = await charge();
    const eventId = crypto.randomUUID();
    await db.outbox_events.insertOne({
      data: {
        id: eventId,
        type: 'proof.accepted',
        aggregate_type: 'charge',
        aggregate_id: id,
        payload: '{}',
        state: 'pending',
        attempts: 0,
        available_at: '2020-01-01T00:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z'
      }
    });
    const summary = await run();
    equal(summary.unsupportedPending, 1);
    equal(
      (
        await db.outbox_events.findOne({
          select: { state: true },
          where: { id: eventId }
        })
      )?.state,
      'pending'
    );
    ok((await listDeliveries(db, OWNER, id)).length > 0);
  });
  it('suppresses rotated pending bodies and refuses an email retry beyond the safe provider window', async () => {
    clock = start;
    const id = await charge();
    await run({ ...transport, email: async () => ({ status: 'uncertain' }) });
    await createOrRotatePublicLink(db, OWNER, id, config.secret, true, Math.floor(clock / 1000));
    clock += 61_000;
    await run();
    ok((await listDeliveries(db, OWNER, id)).every((row) => row.state === 'suppressed'));
    const expired = await charge();
    const expiredAddress = `notify-${count}@example.com`;
    await run({ ...transport, email: async () => ({ status: 'uncertain' }) });
    clock += 23 * 3600_000;
    let attempts = 0;
    // Follow-up rows queued by other fixtures may also come due here, so only this charge is counted.
    await run({
      ...transport,
      email: async (input) => {
        if (input.to === expiredAddress) attempts++;
        return { status: 'accepted', id: 'unexpected' };
      }
    });
    equal(attempts, 0);
    ok((await listDeliveries(db, OWNER, expired)).every((row) => row.state === 'uncertain'));
  });
  it('does not fallback when another device has an accepted ticket for the same notice', async () => {
    clock = start;
    await registerDevice(db, DEBTOR, {
      token: 'ExpoPushToken[notification-sibling]',
      platform: 'android',
      installationId: 'sibling-device'
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: {
        recipient_user: { id: DEBTOR },
        recipient_email_snapshot: 'notify-debtor@example.com'
      }
    });
    await run({
      ...transport,
      push: async (input) =>
        input.token.includes('sibling') ? { status: 'device_unregistered' } : { status: 'accepted', id: 'accepted-sibling' }
    });
    const rows = (
      await db.notification_deliveries.findMany({
        select: { channel: true, state: true, reason: true, available_at: true },
        where: { charge_id: id }
      })
    ).records;
    const waiting = rows.filter((row) => row.channel === 'email');

    equal(waiting.length, 1, 'the follow-up is the only e-mail row');
    equal(waiting[0]!.reason, 'push_followup', 'the accepted sibling keeps the follow-up on its normal schedule');
    equal(Date.parse(waiting[0]!.available_at), start + 2 * 3600_000);
    ok(rows.some((row) => row.channel === 'push' && row.state === 'accepted'));
    ok(rows.some((row) => row.channel === 'push' && row.state === 'failed'));
  });
  it('runs the actual configured scheduler handler with explicit disabled delivery', async () => {
    const id = await charge();
    await db.outbox_events.updateMany({
      where: { aggregate_id: id, type: 'charge.created' },
      data: { available_at: '2020-01-01T00:00:00Z' }
    });
    const context: Parameters<typeof notificationJobHandler>[1] = {
      db,
      email: createEmailClient({ APP_STAGE: 'test', RESEND_API_KEY: 'disabled' }),
      variables: {
        APP_STAGE: 'test',
        NOTIFICATION_EMAIL_TRANSPORT: 'disabled',
        NOTIFICATION_PUSH_TRANSPORT: 'disabled',
        EXPO_ACCESS_TOKEN: 'disabled',
        RESEND_API_KEY: 'disabled',
        RESEND_FROM_EMAIL: 'disabled',
        PUBLIC_WEB_ORIGIN: config.publicOrigin,
        PUBLIC_LINK_HMAC_SECRET: config.secret
      }
    };
    await notificationJobHandler({ requestId: 'native-notification-job', event: null }, context);
    ok((await listDeliveries(db, OWNER, id)).some((row) => row.state === 'disabled'));
  });
  it('routes new notices to configured email when push is disabled without replaying historical disabled push', async (test) => {
    clock = start;
    test.mock.method(Date, 'now', () => clock);
    await registerDevice(db, DEBTOR, {
      token: 'ExpoPushToken[configured-disabled-push]',
      platform: 'ios',
      installationId: 'configured-disabled-push'
    });
    const historicalId = await charge();
    const historicalEmail = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id: historicalId },
      data: { recipient_user: { id: DEBTOR } }
    });
    await run({
      email: async () => ({ status: 'disabled' }),
      push: async () => ({ status: 'disabled' }),
      receipt: async () => ({ status: 'disabled' })
    });
    const historical = await listDeliveries(db, OWNER, historicalId);

    ok(historical.filter((row) => row.channel === 'push').every((row) => row.state === 'disabled'));
    ok(historical.every((row) => row.channel === 'push' || (row.state === 'pending' && row.reason === 'push_followup')));

    const id = await charge();
    const email = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: DEBTOR } }
    });
    const submittedTo: string[] = [];
    test.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      equal(String(url), 'https://api.resend.com/emails', 'disabled Expo must not be called');
      const body = JSON.parse(String(init?.body)) as { to: string[] };
      submittedTo.push(...body.to);
      return Response.json({ id: 'configured-email-fixture' });
    });
    const context: Parameters<typeof notificationJobHandler>[1] = {
      db,
      email: createEmailClient({ APP_STAGE: 'test', RESEND_API_KEY: 'fictitious-native-key' }),
      variables: {
        APP_STAGE: 'test',
        NOTIFICATION_EMAIL_TRANSPORT: 'resend',
        NOTIFICATION_PUSH_TRANSPORT: 'disabled',
        EXPO_ACCESS_TOKEN: 'disabled',
        RESEND_API_KEY: 'fictitious-native-key',
        RESEND_FROM_EMAIL: 'fixture@example.invalid',
        PUBLIC_WEB_ORIGIN: config.publicOrigin,
        PUBLIC_LINK_HMAC_SECRET: config.secret
      }
    };
    await notificationJobHandler({ requestId: 'native-email-with-disabled-push', event: null }, context);
    equal(submittedTo.filter((to) => to === email).length, 1, 'only the initial notice uses enabled email today');
    ok((await listDeliveries(db, OWNER, id)).every((row) => row.channel === 'email' && row.state === 'accepted'));
    equal(submittedTo.filter((to) => to === historicalEmail).length, 0);
    const replayed = await listDeliveries(db, OWNER, historicalId);

    ok(replayed.filter((row) => row.channel === 'push').every((row) => row.state === 'disabled'));
    ok(replayed.every((row) => row.channel === 'push' || (row.state === 'pending' && row.reason === 'push_followup')));

    const disabledId = await charge();
    const disabledEmail = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id: disabledId },
      data: { recipient_user: { id: DEBTOR } }
    });
    await notificationJobHandler(
      { requestId: 'native-both-providers-disabled', event: null },
      {
        ...context,
        variables: {
          ...context.variables,
          NOTIFICATION_EMAIL_TRANSPORT: 'disabled'
        }
      }
    );
    equal(submittedTo.filter((to) => to === disabledEmail).length, 0);
    ok((await listDeliveries(db, OWNER, disabledId)).every((row) => row.state === 'disabled'));
  });
  it('billing with own reminders keeps them; billing without reminders uses the due-date default', async () => {
    clock = start;
    const ownPersonId = (await savePerson(db, OWNER, { name: `Recipient ${++count}`, email: `notify-${count}@example.com` })).id;
    const own = await createBilling(db, OWNER, `notify-own-${count}`, {
      type: 'once',
      totalCents: 1234,
      startDate: '2027-01-04',
      timezone: 'America/Sao_Paulo',
      split: { mode: 'fixed', parts: [{ kind: 'person', personId: ownPersonId, amountCents: 1234 }] },
      reminders: [{ offsetDays: -3, enabled: true }]
    });
    const ownId = own.charges[0]!.id;
    await run();
    // The -3 offset lands on today, proving the billing's own reminders are honored rather than replaced.
    equal((await listDeliveries(db, OWNER, ownId)).length, 2, 'initial notice plus the -3 reminder due today');

    const defaultId = await charge();
    await run();
    equal((await listDeliveries(db, OWNER, defaultId)).length, 1, 'only the initial notice fires today without explicit reminders');
    equal(
      await db.outbox_events.count({
        where: { aggregate_id: defaultId, type: 'charge.reminder' }
      }),
      1,
      'the due-date default schedules exactly one reminder, for the due date itself'
    );
  });
  it('backs off exponentially then dead-letters definitive failures without touching the debt', async () => {
    clock = start;
    const id = await charge();
    let sent = 0;
    const sender: NotificationTransport = {
      ...transport,
      email: async () => {
        sent++;
        return { status: 'transient' };
      }
    };
    await run(sender);
    equal(sent, 1);
    for (const delay of [60_000, 120_000, 240_000, 480_000]) {
      clock += delay - 1;
      const previous: number = sent;
      await run(sender);
      equal(sent, previous);
      clock += 1;
      await run(sender);
    }
    equal(sent, 5);
    ok((await listDeliveries(db, OWNER, id)).every((row) => row.state === 'failed' && row.attempts === 5));
    clock += 1000_000;
    await run(sender);
    equal(sent, 5);
    equal((await db.charges.findOne({ select: { state: true }, where: { id } }))?.state, 'pending');
    const raw = (
      await db.notification_deliveries.findMany({
        select: { render_inputs: true },
        where: { charge_id: id }
      })
    ).records;
    ok(
      raw.every((row) => !row.render_inputs.includes('/pay/')),
      'no complete capability or rendered body may be stored'
    );
  });
  it('keeps an accepted ticket uncertain after receipt HTTP 401 without submitting fallback email', async () => {
    clock = start;
    const userId = await recipient();
    await registerDevice(db, userId, {
      token: 'ExpoPushToken[receipt-auth]',
      installationId: 'receipt-auth',
      platform: 'ios'
    });
    const id = await charge();
    const email = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    const submissions: string[] = [];
    const sender = notificationTransport(
      {
        NOTIFICATION_PUSH_TRANSPORT: 'expo',
        NOTIFICATION_EMAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'fake-key'
      },
      async (url, init) => {
        if (String(url).endsWith('/getReceipts')) return new Response(null, { status: 401 });
        if (String(url).endsWith('/send')) return Response.json({ data: { status: 'ok', id: 'auth-ticket' } });
        submissions.push(...(JSON.parse(String(init?.body)) as { to: string[] }).to);
        return Response.json({ id: 'fake-email' });
      }
    );
    const execute = () => runNotifications(db, sender, { ...config, from: 'fixture@example.com' }, () => clock);
    await execute();
    const accepted = await listDeliveries(db, OWNER, id);
    equal(accepted.filter((row) => row.channel === 'push' && row.state === 'accepted').length, 1);
    equal(accepted.filter((row) => row.channel === 'email').length, 1, 'only the deferred follow-up');
    clock += 15 * 60_000;
    await execute();
    await execute();
    equal(submissions.filter((to) => to === email).length, 0);
    const stalled = (
      await db.notification_deliveries.findMany({
        select: { channel: true, state: true, reason: true, available_at: true },
        where: { charge_id: id }
      })
    ).records;

    ok(stalled.filter((row) => row.channel === 'push').every((row) => row.state === 'uncertain'));
    const waiting = stalled.filter((row) => row.channel === 'email');

    equal(waiting.length, 1);
    equal(waiting[0]!.state, 'pending');
    equal(waiting[0]!.reason, 'push_followup', 'an uncertain ticket never pulls the follow-up forward');
    equal(Date.parse(waiting[0]!.available_at), start + 2 * 3600_000);
  });
  it('releases an explicitly removed token to a new account without transferring history or queued notices', async () => {
    clock = start;
    const accountA = await recipient();
    const accountB = await recipient();
    const input = {
      token: 'ExpoPushToken[account-transfer]',
      installationId: 'same-installation',
      platform: 'ios' as const
    };
    const oldDevice = await registerDevice(db, accountA, input);
    await rejects(() => registerDevice(db, accountB, input), HttpConflictError);
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: accountA } }
    });
    await run({ ...transport, push: async () => ({ status: 'transient' }) });
    await disableSessionDevices(db, accountA);
    const newDevice = await registerDevice(db, accountB, input);
    ok(newDevice.id !== oldDevice.id);
    const current = await db.device_tokens.findOne({
      select: { user_id: true, token: true, active: true },
      where: { id: newDevice.id }
    });
    equal(current?.user_id, accountB);
    equal(current?.token, input.token);
    equal(current?.active, true);
    const old = await db.device_tokens.findOne({
      select: { user_id: true, active: true },
      where: { id: oldDevice.id }
    });
    equal(old?.user_id, accountA);
    equal(old?.active, false);
    const rows = await listDeliveries(db, OWNER, id);
    equal(rows.filter((row) => row.channel === 'push').length, 1);
    ok(rows.filter((row) => row.channel === 'push').every((row) => row.state === 'suppressed'));
    ok(rows.every((row) => row.channel === 'push' || (row.state === 'pending' && row.reason === 'push_followup')));
    equal(
      await db.notification_deliveries.count({
        where: { charge_id: id, device_id: oldDevice.id }
      }),
      1
    );
    await rejects(() => registerDevice(db, accountA, input), HttpConflictError);
  });
  it('does not deactivate a rotated token when the old accepted ticket reports DeviceNotRegistered', async () => {
    clock = start;
    const userId = await recipient();
    const input = {
      token: 'ExpoPushToken[old-registration]',
      installationId: 'receipt-rotation',
      platform: 'ios' as const
    };
    const device = await registerDevice(db, userId, input);
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    await run();
    equal((await listDeliveries(db, OWNER, id)).filter((row) => row.state === 'accepted').length, 1);
    const rotated = await registerDevice(db, userId, {
      ...input,
      token: 'ExpoPushToken[new-registration]'
    });
    equal(rotated.id, device.id);
    clock += 15 * 60_000;
    await run({
      ...transport,
      receipt: async () => ({ status: 'device_unregistered' })
    });
    const current = await db.device_tokens.findOne({
      select: { active: true, token: true },
      where: { id: device.id }
    });
    equal(current?.token, 'ExpoPushToken[new-registration]');
    equal(current?.active, true);
    ok((await listDeliveries(db, OWNER, id)).filter((row) => row.channel === 'push').every((row) => row.state === 'failed'));
  });
  it('does not retarget a retry when registration rotates while its old submission is in flight', async () => {
    clock = start;
    const userId = await recipient();
    const input = {
      token: 'ExpoPushToken[inflight-old]',
      installationId: 'inflight-rotation',
      platform: 'ios' as const
    };
    await registerDevice(db, userId, input);
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    const attempted: string[] = [];
    const sender: NotificationTransport = {
      ...transport,
      push: async ({ token }) => {
        attempted.push(token);
        await registerDevice(db, userId, {
          ...input,
          token: 'ExpoPushToken[inflight-new]'
        });
        return { status: 'transient' };
      }
    };
    await run(sender);
    clock += 60_000;
    await run(sender);
    equal(attempted.filter((token) => token === 'ExpoPushToken[inflight-new]').length, 0);
    const rows = await listDeliveries(db, OWNER, id);

    ok(rows.filter((row) => row.channel === 'push').every((row) => row.state === 'suppressed'));
    ok(rows.every((row) => row.channel === 'push' || (row.state === 'pending' && row.reason === 'push_followup')));
  });
  it('schedules reminders at 09:00 in the billing timezone and holds them until then', async () => {
    clock = start;
    const id = await charge();
    const address = `notify-${count}@example.com`;
    await run();

    const reminder = (
      await db.outbox_events.findMany({
        select: { id: true, available_at: true },
        where: { aggregate_id: id, type: 'charge.reminder' }
      })
    ).records[0];

    equal(Date.parse(reminder!.available_at), Date.parse('2027-01-04T12:00:00Z'), '09:00 in America/Sao_Paulo');

    // A legacy row scanned from UTC midnight must still wait for the civil hour.
    await db.outbox_events.updateOne({
      where: { id: reminder!.id },
      data: { available_at: '2027-01-04T00:00:00Z' }
    });

    clock = Date.parse('2027-01-04T11:40:00Z');
    const sent = emails.filter((entry) => entry.to === address).length;
    await run();

    equal(emails.filter((entry) => entry.to === address).length, sent, 'nothing goes out before 09:00 local');
    const held = await db.outbox_events.findOne({
      select: { state: true, available_at: true },
      where: { id: reminder!.id }
    });

    equal(held?.state, 'pending');
    equal(Date.parse(held!.available_at), Date.parse('2027-01-04T11:55:00Z'), 'deferred by fifteen minutes');

    clock = Date.parse('2027-01-04T12:00:00Z');
    await run();

    equal(emails.filter((entry) => entry.to === address).length, sent + 1, 'the reminder fires at 09:00 local');
    equal(
      (
        await db.outbox_events.findOne({
          select: { state: true },
          where: { id: reminder!.id }
        })
      )?.state,
      'delivered'
    );
  });
  it('sends push first and the e-mail two hours later only while the charge is still pending', async () => {
    clock = start;
    const userId = await recipient();
    await registerDevice(db, userId, {
      token: 'ExpoPushToken[followup-settled]',
      platform: 'ios',
      installationId: 'followup-settled'
    });
    const id = await charge();
    const address = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    await run();

    const planned = (
      await db.notification_deliveries.findMany({
        select: { id: true, channel: true, state: true, reason: true, available_at: true },
        where: { charge_id: id }
      })
    ).records;

    equal(planned.length, 2, 'one push plus the deferred e-mail follow-up');
    equal(planned.find((row) => row.channel === 'push')?.state, 'accepted');

    const followup = planned.find((row) => row.channel === 'email')!;

    equal(followup.state, 'pending');
    equal(followup.reason, 'push_followup');
    equal(Date.parse(followup.available_at), start + 2 * 3600_000);

    clock = start + 3600_000;
    await run();

    equal(emails.filter((entry) => entry.to === address).length, 0, 'the follow-up waits the full two hours');

    await db.charges.updateOne({ where: { id }, data: { state: 'paid' } });
    clock = start + 2 * 3600_000;
    await run();

    equal(emails.filter((entry) => entry.to === address).length, 0, 'a settled charge never falls back to e-mail');
    const settled = (await listDeliveries(db, OWNER, id)).find((row) => row.channel === 'email');

    equal(settled?.state, 'suppressed');
    equal(settled?.reason, 'charge_or_capability_inactive');
  });
  it('sends the follow-up e-mail at T+2h when the charge stays pending', async () => {
    clock = start;
    const userId = await recipient();
    await registerDevice(db, userId, {
      token: 'ExpoPushToken[followup-pending]',
      platform: 'android',
      installationId: 'followup-pending'
    });
    const id = await charge();
    const address = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    await run();

    equal(emails.filter((entry) => entry.to === address).length, 0);

    clock = start + 2 * 3600_000;
    await run();

    equal(emails.filter((entry) => entry.to === address).length, 1);

    await run();

    equal(emails.filter((entry) => entry.to === address).length, 1, 'the follow-up is never resent');
    ok((await listDeliveries(db, OWNER, id)).some((row) => row.channel === 'email' && row.state === 'accepted'));
  });
  it('advances the follow-up e-mail when the push fails definitively', async () => {
    clock = start;
    const userId = await recipient();
    await registerDevice(db, userId, {
      token: 'ExpoPushToken[followup-unregistered]',
      platform: 'ios',
      installationId: 'followup-unregistered'
    });
    const id = await charge();
    const address = `notify-${count}@example.com`;
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    await expandOutbox(db, config, clock);

    const planned = (
      await db.notification_deliveries.findMany({
        select: { id: true, reason: true },
        where: { charge_id: id, channel: 'email' }
      })
    ).records;

    equal(planned.length, 1);
    equal(planned[0]!.reason, 'push_followup');

    await run({ ...transport, push: async () => ({ status: 'device_unregistered' }) });

    const advanced = (
      await db.notification_deliveries.findMany({
        select: { id: true, state: true, reason: true, available_at: true },
        where: { charge_id: id, channel: 'email' }
      })
    ).records;

    equal(advanced.length, 1, 'the follow-up row is reused, never duplicated');
    equal(advanced[0]!.state, 'pending');
    equal(advanced[0]!.reason, 'push_failed_fallback');
    ok(Date.parse(advanced[0]!.available_at) <= clock);

    await run();

    equal(emails.filter((entry) => entry.to === address).length, 1);
    const rows = (
      await db.notification_deliveries.findMany({
        select: { id: true },
        where: { charge_id: id, channel: 'email' }
      })
    ).records;

    equal(rows.length, 1, 'the fallback never inserts a second e-mail row');
    equal(rows[0]!.id, planned[0]!.id, 'the planned follow-up row is the one that goes out');
  });
  it('keeps the follow-up backoff and provider reason when a late push failure arrives', async () => {
    clock = start;
    const userId = await recipient();
    await registerDevice(db, userId, {
      token: 'ExpoPushToken[followup-backoff]',
      platform: 'ios',
      installationId: 'followup-backoff'
    });
    const id = await charge();
    await db.charges.updateOne({
      where: { id },
      data: { recipient_user: { id: userId } }
    });
    const polling: NotificationTransport = { ...transport, receipt: async () => ({ status: 'pending' }) };
    await run(polling);

    clock = start + 2 * 3600_000;
    await run({ ...polling, email: async () => ({ status: 'transient' }) });

    const attempted = (
      await db.notification_deliveries.findMany({
        select: { id: true, state: true, reason: true, attempts: true, available_at: true },
        where: { charge_id: id, channel: 'email' }
      })
    ).records[0]!;

    equal(attempted.attempts, 1);
    equal(attempted.state, 'pending');
    equal(attempted.reason, 'transient');
    ok(Date.parse(attempted.available_at) > clock, 'the follow-up is inside its provider backoff');

    // Receipts are polled for up to a day, so the definitive push failure lands mid-backoff.
    await db.notification_deliveries.updateMany({
      where: { charge_id: id, channel: 'push' },
      data: { available_at: new Date(clock).toISOString() }
    });
    await run({ ...polling, receipt: async () => ({ status: 'device_unregistered' }) });

    const kept = (
      await db.notification_deliveries.findMany({
        select: { id: true, state: true, reason: true, available_at: true },
        where: { charge_id: id, channel: 'email' }
      })
    ).records;

    equal(kept.length, 1);
    equal(kept[0]!.id, attempted.id);
    equal(kept[0]!.state, 'pending');
    equal(kept[0]!.reason, 'transient', 'a late push failure must not overwrite the provider reason');
    equal(Date.parse(kept[0]!.available_at), Date.parse(attempted.available_at), 'the provider backoff is preserved');
  });
  it('e-mails immediately when the recipient has no active device', async () => {
    clock = start;
    const id = await charge();
    const address = `notify-${count}@example.com`;
    await expandOutbox(db, config, clock);

    const planned = (
      await db.notification_deliveries.findMany({
        select: { channel: true, state: true, reason: true, available_at: true },
        where: { charge_id: id }
      })
    ).records;

    equal(planned.length, 1);
    equal(planned[0]!.channel, 'email');
    equal(planned[0]!.state, 'pending');
    ok(!planned[0]!.reason, 'no follow-up reason without a push sibling');
    equal(Date.parse(planned[0]!.available_at), clock);

    await run();

    equal(emails.filter((entry) => entry.to === address).length, 1);
  });
});
