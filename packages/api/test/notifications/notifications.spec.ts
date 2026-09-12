import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError } from '@ez4/gateway';
import { createBilling } from '../../src/billings/repositories/billing';
import { payCharge } from '../../src/charges/repositories/charge';
import { ApiError } from '../../src/common/errors';
import { listEvents } from '../../src/common/repositories/events';
import { saveContact } from '../../src/contacts/repositories/contact';
import { ReminderQuotaError } from '../../src/notifications/errors';
import { manualReminder, registerDevice } from '../../src/notifications/repositories/notification';
import { EMAIL_FOLLOWUP_MS, instantAt, REMINDER_HOUR } from '../../src/notifications/services/planner';
import {
  announceCharges,
  type ChargeNotifyEvent,
  followUpCharge,
  notifyCharge,
  notifyIdentifier,
  sendChargeNotice
} from '../../src/notifications/services/send';
import { savePaymentMethod } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = 'b1111111-1111-4111-8111-111111111111';
const DEBTOR = 'b2222222-2222-4222-8222-222222222222';
const OTHER = 'b3333333-3333-4333-8333-333333333333';
const NOPIX = 'b4444444-4444-4444-8444-444444444444';

const DEBTOR_EMAIL = 'notify-debtor@example.com';
const DUE_DATE = '2029-01-04';
const TZ = 'America/Sao_Paulo';
const start = Date.parse('2029-01-01T11:00:00Z');
const DAY = 24 * 3600_000;

const notice = fakeNotice();
const { context, sent, notify } = notice;

let clock = start;
let count = 0;

const people = new Map<string, string>();

async function person(owner: string, name: string, email: string) {
  const key = `${owner}:${email}`;
  const known = people.get(key);

  if (known) {
    return known;
  }

  const created = await saveContact(db, owner, { name, email });

  people.set(key, created.userId);

  return created.userId;
}

/** A once charge for one person; `announce` runs the creation notice through the fakes. */
async function charge(owner = OWNER, email?: string, announce = false) {
  count++;

  const address = email ?? `notify-${count}@example.com`;
  const userId = await person(owner, `Recipient ${count}`, address);

  const billing = await createBilling(
    db,
    owner,
    `notify-${count}`,
    {
      type: 'once',
      totalCents: 1234,
      startDate: DUE_DATE,
      timezone: TZ,
      split: { mode: 'fixed', parts: [{ kind: 'user', userId, amountCents: 1234 }] }
    },
    new Date(clock),
    undefined,
    announce ? context : undefined
  );

  return { id: billing.charges[0]!.id, address, userId };
}

/** The owner's own bill: nobody on the other side, the key typed by hand. */
async function payableCharge(announce = false) {
  count++;

  const billing = await createBilling(
    db,
    OWNER,
    `notify-payable-${count}`,
    {
      type: 'once',
      direction: 'payable',
      description: 'Aluguel',
      totalCents: 150_000,
      startDate: DUE_DATE,
      timezone: TZ,
      pix: { keyType: 'email', key: 'landlord@example.com', label: 'Imobiliária' }
    },
    new Date(clock),
    undefined,
    announce ? context : undefined
  );

  return billing.charges[0]!.id;
}

async function chargeRow(id: string) {
  const row = await db.charges.findOne({
    select: { id: true, billing_id: true, due_date: true, state: true, public_id: true },
    where: { id }
  });

  ok(row);

  return row;
}

/** Notices fan out to every active device, so each push case starts from a clean registration. */
async function soleDevice(userId: string, token: string, installationId: string) {
  await db.device_tokens.updateMany({ where: { user_id: userId }, data: { active: false } });

  return registerDevice(db, userId, { token, platform: 'ios', installationId });
}

async function noDevices(userId: string) {
  await db.device_tokens.updateMany({ where: { user_id: userId }, data: { active: false } });
}

function send(id: string, template: 'initial' | 'reminder' | 'manual' = 'initial', offsetDays?: number) {
  return sendChargeNotice(db, context, id, template, clock, { offsetDays });
}

const followUp = (id: string, template: ChargeNotifyEvent['template'] = 'initial', offsetDays?: number) => ({
  date: new Date(clock + EMAIL_FOLLOWUP_MS),
  event: { chargeId: id, template, stage: 'followup' as const, ...(offsetDays === undefined ? {} : { offsetDays }) }
});

describe('charge notices, follow-ups and devices', () => {
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

  it('pushes to every active device and leaves the e-mail alone', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[fanout-a]', 'fanout-a');
    await registerDevice(db, DEBTOR, { token: 'ExpoPushToken[fanout-b]', platform: 'android', installationId: 'fanout-b' });

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await send(id), { channels: ['push', 'push'] });
    deepEqual(sent.pushes.map((push) => push.token).sort(), ['ExpoPushToken[fanout-a]', 'ExpoPushToken[fanout-b]']);
    ok(sent.pushes[0]!.url.startsWith(`${context.config.publicOrigin}/pay/`), 'the push deep-links to the payment page');
    equal(sent.emails.length, 0);
    ok((await chargeRow(id)).public_id, 'sending mints the public link the notice carries');

    const [event] = await listEvents(db, id, 'notice.sent');

    deepEqual(event?.payload, { template: 'initial', channels: ['push', 'push'] });
    equal(event?.created_at, new Date(clock).toISOString());
  });

  it('e-mails when the recipient has no device, and records which channel reached them', async () => {
    clock = start;
    sent.reset();

    const { id, address } = await charge();

    deepEqual(await send(id), { channels: ['email'] });
    equal(sent.pushes.length, 0);
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, address);
    equal(sent.emails[0]!.key, `${id}:initial:${clock}`);
    equal(sent.emails[0]!.from, context.config.from);
    ok(sent.emails[0]!.text.includes('/pay/'));
    deepEqual((await listEvents(db, id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['email'] });

    // A reminder names its offset so a redelivery can be told apart from the next one.
    deepEqual(await send(id, 'reminder', 0), { channels: ['email'] });

    const reminder = (await listEvents(db, id, 'notice.sent')).find((event) => event.payload['template'] === 'reminder');

    deepEqual(reminder?.payload, { template: 'reminder', channels: ['email'], offsetDays: 0 });
  });

  it('deactivates a dead device and falls back to e-mail', async () => {
    clock = start;
    sent.reset();

    const device = await soleDevice(DEBTOR, 'ExpoPushToken[dead-device]', 'dead-device');
    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    sent.state.pushStatus = 'device_unregistered';

    try {
      deepEqual(await send(id), { channels: ['email'] });
    } finally {
      sent.state.pushStatus = 'accepted';
    }

    equal(sent.pushes.length, 1);
    equal(sent.emails[0]!.to, DEBTOR_EMAIL);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: device.id } }))?.active, false);

    // Nothing is retried: the next notice simply finds no device left.
    sent.reset();
    deepEqual(await send(id, 'reminder', 0), { channels: ['email'] });
    equal(sent.pushes.length, 0);
  });

  it('skips a charge without a Pix key, one without a recipient and one nobody can reach', async () => {
    clock = start;
    sent.reset();

    const { id } = await charge(NOPIX);

    deepEqual(await send(id), { channels: [] });
    deepEqual((await listEvents(db, id, 'notice.skipped'))[0]?.payload, { template: 'initial', reason: 'pix_required' });
    equal((await chargeRow(id)).public_id ?? null, null, 'no link is minted for a charge that cannot be paid yet');

    const gone = await charge();

    await db.users.updateOne({ where: { id: gone.userId }, data: { deleted_at: new Date(clock).toISOString() } });

    deepEqual(await send(gone.id), { channels: [] });
    deepEqual((await listEvents(db, gone.id, 'notice.skipped'))[0]?.payload, { template: 'initial', reason: 'no_recipient' });

    const silent = await charge();

    await db.users.updateOne({ where: { id: silent.userId }, data: { email: null as unknown as undefined } });
    await noDevices(silent.userId);

    deepEqual(await send(silent.id, 'manual'), { channels: [] });
    deepEqual((await listEvents(db, silent.id, 'notice.skipped'))[0]?.payload, { template: 'manual', channels: [], reason: 'no_channel' });
    equal(sent.emails.length, 0);
    equal(sent.pushes.length, 0);
  });

  it('sends the owner of a conta a pagar their own copy, without a public link', async () => {
    clock = start;
    sent.reset();

    await soleDevice(OWNER, 'ExpoPushToken[owner-self]', 'owner-self');

    const id = await payableCharge(true);

    equal(sent.pushes.length, 0, 'the owner just typed the bill: no hello');
    equal(sent.emails.length, 0);
    equal(notify.events.has(notifyIdentifier(id)), false, 'only the reminders of the daily plan reach them');

    deepEqual(await send(id, 'reminder', 0), { channels: ['push'] });
    equal(sent.pushes[0]!.token, 'ExpoPushToken[owner-self]');
    equal(sent.pushes[0]!.url, '');
    equal(sent.emails.length, 0);
    equal((await chargeRow(id)).public_id ?? null, null);

    // Without a device there is no e-mail to fall back to: the owner reads the app.
    await noDevices(OWNER);
    deepEqual(await send(id, 'reminder', 0), { channels: [] });
    deepEqual((await listEvents(db, id, 'notice.skipped'))[0]?.payload, {
      template: 'reminder',
      channels: [],
      offsetDays: 0,
      reason: 'no_channel'
    });
  });

  it('announces a new charge by push and arms the e-mail follow-up two hours later', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[announce]', 'announce');

    const { id } = await charge(OWNER, DEBTOR_EMAIL, true);

    equal(sent.pushes.length, 1);
    equal(sent.emails.length, 0);
    deepEqual((await listEvents(db, id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['push'] });
    deepEqual(notify.events.get(notifyIdentifier(id)), followUp(id));
    equal(followUp(id).date.toISOString(), '2029-01-01T13:00:00.000Z');

    // Without a device the e-mail goes out right away: nothing is left to follow up.
    const plain = await charge(OWNER, undefined, true);

    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, plain.address);
    deepEqual((await listEvents(db, plain.id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['email'] });
    equal(notify.events.has(notifyIdentifier(plain.id)), false);

    sent.reset();
    await announceCharges(db, context, [crypto.randomUUID()], clock);
    equal(sent.emails.length, 0);
    equal(sent.pushes.length, 0);
  });

  it('arms the follow-up for a scheduled reminder only when the push went out', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[reminder-push]', 'reminder-push');

    const pushed = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await notifyCharge(db, context, pushed.id, 'reminder', clock, -3), { channels: ['push'] });
    deepEqual(notify.events.get(notifyIdentifier(pushed.id)), followUp(pushed.id, 'reminder', -3));

    const mailed = await charge();

    deepEqual(await notifyCharge(db, context, mailed.id, 'reminder', clock, -3), { channels: ['email'] });
    equal(notify.events.has(notifyIdentifier(mailed.id)), false, 'an e-mail sent right away needs no follow-up');

    // A push nobody accepted falls back to e-mail and, again, arms nothing.
    sent.state.pushStatus = 'disabled';

    try {
      deepEqual(await notifyCharge(db, context, pushed.id, 'reminder', clock, 0), { channels: ['email'] });
    } finally {
      sent.state.pushStatus = 'accepted';
    }

    deepEqual(notify.events.get(notifyIdentifier(pushed.id)), followUp(pushed.id, 'reminder', -3), 'the earlier follow-up stays');
  });

  it('follows a push up by e-mail once, while the charge is open with nothing under review', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[followup]', 'followup');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await notifyCharge(db, context, id, 'reminder', clock, 0), { channels: ['push'] });

    const armed = notify.events.get(notifyIdentifier(id));

    ok(armed);
    clock = armed.date.getTime();

    deepEqual(await followUpCharge(db, context, armed.event, clock), { channels: ['email'] });
    equal(sent.pushes.length, 1, 'the follow-up never pushes again');
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, DEBTOR_EMAIL);
    equal(sent.emails[0]!.key, `${id}:reminder:${clock}`);

    const mailed = (await listEvents(db, id, 'notice.sent')).find((event) => (event.payload['channels'] as string[]).includes('email'));

    deepEqual(mailed?.payload, { template: 'reminder', channels: ['email'], offsetDays: 0 });

    deepEqual(await followUpCharge(db, context, armed.event, clock), { channels: [] }, 'a redelivery never mails twice');
    equal(sent.emails.length, 1);

    // The same template with another offset is a different reminder, followed up on its own.
    deepEqual(await followUpCharge(db, context, { ...armed.event, offsetDays: -3 }, clock), { channels: ['email'] });
    equal(sent.emails.length, 2);

    // A proof waiting for the creditor silences the follow-up; a rejected one reopens it.
    const reviewing = await charge(OWNER, DEBTOR_EMAIL);
    const event: ChargeNotifyEvent = { chargeId: reviewing.id, template: 'initial', stage: 'followup' };

    await db.charges.updateOne({ where: { id: reviewing.id }, data: { proof_state: 'pending' } });
    deepEqual(await followUpCharge(db, context, event, clock), { channels: [] });
    equal((await listEvents(db, reviewing.id, 'notice.skipped')).length, 0, 'silence is not a skip');

    await db.charges.updateOne({ where: { id: reviewing.id }, data: { proof_state: 'rejected' } });
    deepEqual(await followUpCharge(db, context, event, clock), { channels: ['email'] });

    // A settled charge sends nothing at all.
    const paid = await charge(OWNER, DEBTOR_EMAIL);

    await payCharge(db, OWNER, paid.id);
    deepEqual(await followUpCharge(db, context, { ...event, chargeId: paid.id }, clock), { channels: [] });
    deepEqual(await send(paid.id, 'reminder', 0), { channels: [] }, 'a closed charge sends nothing');
    equal((await listEvents(db, paid.id, 'notice.skipped')).length, 0);
    equal(sent.emails.length, 3);
  });

  it('computes reminder instants at 06:00 of the billing timezone', () => {
    equal(REMINDER_HOUR, 6);
    equal(instantAt(DUE_DATE, REMINDER_HOUR, TZ).toISOString(), '2029-01-04T09:00:00.000Z');
    equal(instantAt('2029-07-04', REMINDER_HOUR, TZ).toISOString(), '2029-07-04T09:00:00.000Z');
    equal(instantAt(DUE_DATE, REMINDER_HOUR, 'America/Manaus').toISOString(), '2029-01-04T10:00:00.000Z');
    equal(instantAt(DUE_DATE, 0, 'UTC').toISOString(), '2029-01-04T00:00:00.000Z');
    equal(EMAIL_FOLLOWUP_MS, 2 * 3600_000);
  });

  it('sends a manual reminder for the creditor only and refuses another one inside twenty-four hours', async () => {
    clock = start;
    sent.reset();

    const { id, address } = await charge();

    await rejects(() => manualReminder(db, OTHER, id, context, () => clock), HttpForbiddenError);
    await rejects(() => manualReminder(db, DEBTOR, id, context, () => clock), HttpForbiddenError);
    const payable = await payableCharge();

    await rejects(() => manualReminder(db, OWNER, payable, context, () => clock), HttpForbiddenError);

    deepEqual(await manualReminder(db, OWNER, id, context, () => clock), { queued: true });
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, address);
    deepEqual((await listEvents(db, id, 'notice.sent'))[0]?.payload, { template: 'manual', channels: ['email'] });

    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ReminderQuotaError);
    equal(sent.emails.length, 1);

    clock += DAY + 1;

    deepEqual(await manualReminder(db, OWNER, id, context, () => clock), { queued: true });
    equal(sent.emails.length, 2);

    await payCharge(db, OWNER, id);
    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ApiError);
  });

  it('sends a manual reminder on every channel at once and arms no follow-up', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[manual-a]', 'manual-a');
    await registerDevice(db, DEBTOR, { token: 'ExpoPushToken[manual-b]', platform: 'android', installationId: 'manual-b' });

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await manualReminder(db, OWNER, id, context, () => clock), { queued: true });
    deepEqual(sent.pushes.map((push) => push.token).sort(), ['ExpoPushToken[manual-a]', 'ExpoPushToken[manual-b]']);
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, DEBTOR_EMAIL);
    deepEqual((await listEvents(db, id, 'notice.sent'))[0]?.payload, { template: 'manual', channels: ['push', 'push', 'email'] });
    equal(notify.events.has(notifyIdentifier(id)), false, 'the creditor pressed the button: nothing to follow up');

    // The quota counts the reminder that reached someone, whatever the channel.
    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ReminderQuotaError);
    equal(sent.pushes.length, 2);
    equal(sent.emails.length, 1);
  });

  it('reports a reminder nobody can receive and leaves the daily quota untouched', async () => {
    clock = start;
    sent.reset();

    const { id, userId } = await charge();

    // The debtor has neither a device nor an address: the attempt is recorded as skipped, not sent.
    await db.users.updateOne({ where: { id: userId }, data: { email: null as unknown as undefined } });
    await noDevices(userId);

    deepEqual(await manualReminder(db, OWNER, id, context, () => clock), { queued: false });
    deepEqual(
      await manualReminder(db, OWNER, id, context, () => clock),
      { queued: false },
      'a suppressed attempt never blocks the next one'
    );
    equal((await listEvents(db, id, 'notice.sent')).length, 0);
    equal((await listEvents(db, id, 'notice.skipped')).length, 2);
    equal(sent.emails.length, 0);
  });

  it('rotates a device token in place and keeps it active', async () => {
    const input = { token: 'ExpoPushToken[rotation-old]', platform: 'ios' as const, installationId: 'rotation-device' };
    const device = await soleDevice(DEBTOR, input.token, input.installationId);
    const rotated = await registerDevice(db, DEBTOR, { ...input, token: 'ExpoPushToken[rotation-new]' });

    equal(rotated.id, device.id);
    equal(rotated.active, true);

    const current = await db.device_tokens.findOne({ select: { token: true, active: true }, where: { id: device.id } });

    equal(current?.token, 'ExpoPushToken[rotation-new]');
    equal(current?.active, true);
    ok((await listEvents(db, device.id, 'notifications.device_registered')).length >= 2);
  });

  it('refuses to move a device between accounts', async () => {
    const input = { token: 'ExpoPushToken[account-transfer]', platform: 'ios' as const, installationId: 'account-transfer' };

    await registerDevice(db, DEBTOR, input);
    await rejects(() => registerDevice(db, OTHER, input), ApiError);
    await rejects(
      () => registerDevice(db, DEBTOR, { ...input, token: 'bad token' }),
      (error: Error & { status?: number }) => error.status === 400
    );
  });
});
