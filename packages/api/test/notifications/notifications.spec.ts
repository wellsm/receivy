import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Service } from '@ez4/common';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { BucketTester } from '@ez4/local-storage/test';
import { BillingKind, BillingRecurrence, type ChannelSet, DevicePlatform, Direction, PaymentProvider, PixKeyType, ProofKind, SplitMode, SplitPartKind, SYSTEM_REMINDER_CONFIG } from '@receivy/common';
import { createBilling } from '../../src/billings/services/billing';
import { ChargeInReviewError, SettledNoRemindersError } from '../../src/charges/errors';
import { StoredProofState } from '../../src/charges/schemas/charge';
import { ApiError } from '../../src/common/errors';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { ReminderQuotaError } from '../../src/notifications/errors';
import { registerDevice, manualReminder, reminderPreview } from '../../src/notifications/services/notification';
import { PaymentNotice, pushPaymentNotice } from '../../src/notifications/services/payment-notices';
import { instantAt, REMINDER_HOUR } from '../../src/notifications/services/planner';
import { announceCharges, NoticeTemplate, notifyCharge, notifyIdentifier, planReminders, sendChargeNotice } from '../../src/notifications/services/send';
import { LinkRepository } from '../../src/public/repositories/link';
import { LinkableType } from '../../src/public/schemas/link';
import { issueOptOutToken } from '../../src/public/services/capability';
import { optInByToken, optOutByToken } from '../../src/public/services/public-link';
import { AccountRepository } from '../../src/users/repositories/account';
import { type AccountService, createService as createAccountService } from '../../src/users/services/account';
import { charges, cleanupUsers, contacts, createUser, db, paymentMethods } from '../fixtures/financial';
import { fakeNotice, TEST_CONFIG } from '../fixtures/scheduling';

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

const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
const accounts = createAccountService({ db, avatarFiles: bucket, proofFiles: bucket } as unknown as Service.Context<AccountService>);

const publicLinks = {
  optOut: (token: string) => optOutByToken(db, TEST_CONFIG.secret, token),
  optIn: (token: string) => optInByToken(db, TEST_CONFIG.secret, token)
};

const notifications = {
  manualReminder: (userId: string, chargeId: string) => manualReminder(db, userId, chargeId, context, () => clock),
  reminderPreview: (userId: string, chargeId: string) => reminderPreview(db, userId, chargeId, context)
};

let clock = start;
let count = 0;

const people = new Map<string, string>();

async function person(owner: string, name: string, email: string) {
  const key = `${owner}:${email}`;
  const known = people.get(key);

  if (known) {
    return known;
  }

  const created = await contacts.save(owner, { name, email });

  people.set(key, created.userId);

  return created.userId;
}

/** A contact of the owner with no account of its own: it names who receives, and never hears about anything. */
async function contactOf(name: string) {
  return (await contacts.save(OWNER, { name })).id;
}

async function contactUserOf(contactId: string) {
  return (await ContactRepository.user(db, OWNER, contactId)).userId;
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
      recurrence: BillingRecurrence.Once,
      totalCents: 1234,
      startDate: DUE_DATE,
      timezone: TZ,
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId, amountCents: 1234 }] }
    },
    new Date(clock),
    undefined,
    announce ? context : undefined
  );

  return { id: billing.charges[0]!.id, address, userId };
}

/** The owner's own bill, owed to a contact with no account: it points at a key filed under that contact. */
async function payableCharge(announce = false) {
  count++;

  const contactId = await contactOf(`Imobiliária ${count}`);
  const key = await paymentMethods.save(OWNER, {
    provider: PaymentProvider.Pix,
    kind: PixKeyType.Email,
    value: `landlord-${count}@example.com`,
    label: 'Imobiliária',
    contactId
  });
  const billing = await createBilling(
    db,
    OWNER,
    `notify-payable-${count}`,
    {
      recurrence: BillingRecurrence.Once,
      contactId,
      description: 'Aluguel',
      totalCents: 150_000,
      startDate: DUE_DATE,
      timezone: TZ,
      paymentMethodId: key.id
    },
    new Date(clock),
    undefined,
    announce ? context : undefined
  );

  return billing.charges[0]!.id;
}

/** A registro due on DUE_DATE, created before it: still pending, nobody to notify. */
async function registroCharge(direction: Direction = Direction.Receivable) {
  count++;

  const contactId = await contactOf(`Empresa X ${count}`);
  const billing = await createBilling(
    db,
    OWNER,
    `notify-registro-${count}`,
    {
      recurrence: BillingRecurrence.Once,
      description: 'Salário',
      totalCents: 500_000,
      startDate: DUE_DATE,
      timezone: TZ,
      kind: BillingKind.Record,
      ...(direction === Direction.Payable
        ? { contactId }
        : { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: await contactUserOf(contactId) }] } })
    },
    new Date(clock)
  );

  return billing.charges[0]!.id;
}

async function chargeRow(id: string) {
  const row = await db.charges.findOne({
    select: { id: true, billing_id: true, due_date: true, state: true },
    where: { id }
  });

  ok(row);

  // The public handle lives in `links` now; the assertions still read it off the charge shape.
  const link = await LinkRepository.live(db, LinkableType.Charge, id);

  return { ...row, public_id: link?.public_id };
}

/** Puts a charge into a proof state the flow would have produced; replacing means a new row, as in production. */
async function putProof(chargeId: string, state: StoredProofState, kind = ProofKind.File, sentAt?: string, reason?: string) {
  const stamp = new Date(clock).toISOString();

  await db.proofs.deleteMany({ where: { charge_id: chargeId } });
  await db.proofs.insertOne({
    data: {
      id: crypto.randomUUID(),
      charge: { id: chargeId },
      state,
      kind,
      actor_hash: `notifications-spec:${chargeId}`,
      ...(sentAt ? { sent_at: sentAt } : {}),
      ...(reason ? { reason } : {}),
      created_at: stamp,
      updated_at: stamp
    }
  });
}

/** Notices fan out to every active device, so each push case starts from a clean registration. */
async function soleDevice(userId: string, token: string, installationId: string) {
  await db.device_tokens.updateMany({ where: { user_id: userId }, data: { active: false } });

  return registerDevice(db, userId, { token, platform: DevicePlatform.Ios, installationId });
}

async function noDevices(userId: string) {
  await db.device_tokens.updateMany({ where: { user_id: userId }, data: { active: false } });
}

const EMAIL_ONLY: ChannelSet = { email: true, whatsapp: false };
const PUSH_ONLY: ChannelSet = { email: false, whatsapp: false };

function send(id: string, template: NoticeTemplate = NoticeTemplate.Initial, offsetDays?: number, channels: ChannelSet = EMAIL_ONLY) {
  return sendChargeNotice(db, context, id, template, clock, { offsetDays, channels });
}

describe('charge notices, channels and devices', () => {
  before(async () => {
    const [row] = await db.rawQuery('SELECT current_database() AS name');

    equal(row?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'notify-owner@example.com', name: 'Owner' });
    await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'notify-owner@example.com' });
    await createUser(db, { id: DEBTOR, email: DEBTOR_EMAIL, name: 'Debtor' });
    await createUser(db, { id: OTHER, email: 'notify-other@example.com', name: 'Other' });
    await createUser(db, { id: NOPIX, email: 'notify-nopix@example.com', name: 'No Pix' });
  });

  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER, NOPIX]));

  it('sends push and e-mail together on the due-day rule and arms no follow-up', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[rule]', 'rule');

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: ['push', 'email'], dropped: [] });
    equal(sent.pushes.length, 1);
    equal(sent.emails.length, 1);
    equal(notify.events.has(notifyIdentifier(id)), false);
    ok(sent.emails[0]!.text.includes('/opt-out/'), 'the e-mail carries the opt-out link');
  });

  it('follows the owner config: a WhatsApp-only rule drops the e-mail and reports WhatsApp unavailable', async () => {
    clock = start;
    sent.reset();

    await noDevices(DEBTOR);
    await accounts.saveReminders(OWNER, {
      reminders: [{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: true } }],
      manual: { email: true, whatsapp: true }
    });

    try {
      const { id } = await charge(OWNER, DEBTOR_EMAIL);

      deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: [], dropped: [{ channel: 'whatsapp', reason: 'no_phone' }] });
      equal(sent.emails.length, 0);

      const skipped = (await EventRepository.list(db, id, 'notice.skipped')).map((event) => event.payload);

      deepEqual(skipped.at(-1)!['dropped'], [{ channel: 'whatsapp', reason: 'no_phone' }]);
    } finally {
      await accounts.clearReminders(OWNER);
    }
  });

  it('sends nothing when the owner disabled the rule at that offset, and reports no_channel', async () => {
    clock = start;
    sent.reset();

    await noDevices(DEBTOR);
    await accounts.saveReminders(OWNER, {
      reminders: [{ offsetDays: 0, enabled: false, channels: { email: true, whatsapp: false } }],
      manual: { email: true, whatsapp: true }
    });

    try {
      const { id } = await charge(OWNER, DEBTOR_EMAIL);

      deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: [], dropped: [] });
      equal(sent.emails.length, 0);
      equal(sent.pushes.length, 0);
      deepEqual((await EventRepository.list(db, id, 'notice.skipped'))[0]?.payload, {
        template: 'reminder',
        channels: [],
        offsetDays: 0,
        reason: 'no_channel'
      });
    } finally {
      await accounts.clearReminders(OWNER);
    }
  });

  it('respects the debtor e-mail opt-out and records why', async () => {
    clock = start;
    sent.reset();

    await noDevices(DEBTOR);

    const { id, userId } = await charge(OWNER, DEBTOR_EMAIL);

    await AccountRepository.setEmailOptOut(db, userId, new Date(clock).toISOString(), new Date(clock).toISOString());

    try {
      deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: [], dropped: [{ channel: 'email', reason: 'opted_out' }] });
    } finally {
      await AccountRepository.setEmailOptOut(db, userId, null, new Date(clock).toISOString());
    }
  });

  it('pushes to every active device and leaves the e-mail alone when the rule wants none', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[fanout-a]', 'fanout-a');
    await registerDevice(db, DEBTOR, {
      token: 'ExpoPushToken[fanout-b]',
      platform: DevicePlatform.Android,
      installationId: 'fanout-b'
    });

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    deepEqual(await send(id, NoticeTemplate.Initial, undefined, PUSH_ONLY), { channels: ['push', 'push'], dropped: [] });
    deepEqual(sent.pushes.map((push) => push.token).sort(), ['ExpoPushToken[fanout-a]', 'ExpoPushToken[fanout-b]']);
    ok(sent.pushes[0]!.url.startsWith(`${context.config.publicOrigin}/pay/`), 'the push deep-links to the payment page');
    equal(sent.emails.length, 0);
    ok((await chargeRow(id)).public_id, 'sending mints the public link the notice carries');

    const [event] = await EventRepository.list(db, id, 'notice.sent');

    deepEqual(event?.payload, { template: 'initial', channels: ['push', 'push'] });
    equal(event?.created_at, new Date(clock).toISOString());
  });

  it('e-mails when the recipient has no device, and records which channel reached them', async () => {
    clock = start;
    sent.reset();

    const { id, address } = await charge();

    deepEqual(await send(id), { channels: ['email'], dropped: [] });
    equal(sent.pushes.length, 0);
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, address);
    equal(sent.emails[0]!.key, `${id}:initial:${clock}`);
    equal(sent.emails[0]!.from, context.config.from);
    ok(sent.emails[0]!.text.includes('/pay/'));
    deepEqual((await EventRepository.list(db, id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['email'] });

    // A reminder names its offset so a redelivery can be told apart from the next one.
    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: ['email'], dropped: [] });

    const reminder = (await EventRepository.list(db, id, 'notice.sent')).find((event) => event.payload['template'] === 'reminder');

    deepEqual(reminder?.payload, { template: 'reminder', channels: ['email'], offsetDays: 0 });
  });

  it('deactivates a dead device and falls back to e-mail', async () => {
    clock = start;
    sent.reset();

    const device = await soleDevice(DEBTOR, 'ExpoPushToken[dead-device]', 'dead-device');
    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    sent.state.pushStatus = 'device_unregistered';

    try {
      deepEqual(await send(id), { channels: ['email'], dropped: [] });
    } finally {
      sent.state.pushStatus = 'accepted';
    }

    equal(sent.pushes.length, 1);
    equal(sent.emails[0]!.to, DEBTOR_EMAIL);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: device.id } }))?.active, false);

    // Nothing is retried: the next notice simply finds no device left.
    sent.reset();
    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: ['email'], dropped: [] });
    equal(sent.pushes.length, 0);
  });

  it('skips a charge without a Pix key, one without a recipient and one nobody can reach', async () => {
    clock = start;
    sent.reset();

    const { id } = await charge(NOPIX);

    deepEqual(await send(id), { channels: [], dropped: [] });
    deepEqual((await EventRepository.list(db, id, 'notice.skipped'))[0]?.payload, { template: 'initial', reason: 'pix_required' });
    equal((await chargeRow(id)).public_id ?? null, null, 'no link is minted for a charge that cannot be paid yet');

    const gone = await charge();

    await db.users.updateOne({ where: { id: gone.userId }, data: { deleted_at: new Date(clock).toISOString() } });

    deepEqual(await send(gone.id), { channels: [], dropped: [] });
    deepEqual((await EventRepository.list(db, gone.id, 'notice.skipped'))[0]?.payload, { template: 'initial', reason: 'no_recipient' });

    const silent = await charge();

    await db.users.updateOne({ where: { id: silent.userId }, data: { email: null as unknown as undefined } });
    await noDevices(silent.userId);

    deepEqual(await send(silent.id, NoticeTemplate.Manual), { channels: [], dropped: [{ channel: 'email', reason: 'no_email' }] });
    deepEqual((await EventRepository.list(db, silent.id, 'notice.skipped'))[0]?.payload, {
      template: 'manual',
      channels: [],
      dropped: [{ channel: 'email', reason: 'no_email' }],
      reason: 'no_channel'
    });
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

    // Day 0's default rule wants e-mail, and the owner's own reminder follows the config just like anyone else's.
    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: ['push', 'email'], dropped: [] });
    equal(sent.pushes[0]!.token, 'ExpoPushToken[owner-self]');
    equal(sent.pushes[0]!.url, '');
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, 'notify-owner@example.com');
    equal((await chargeRow(id)).public_id ?? null, null);

    // Without a device the e-mail the rule wants still reaches the owner.
    await noDevices(OWNER);
    sent.reset();

    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: ['email'], dropped: [] });
    equal(sent.emails.length, 1);

    await db.users.updateOne({ where: { id: OWNER }, data: { email: null as unknown as undefined } });
    sent.reset();

    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: [], dropped: [{ channel: 'email', reason: 'no_email' }] });
    deepEqual((await EventRepository.list(db, id, 'notice.skipped'))[0]?.payload, {
      template: 'reminder',
      channels: [],
      offsetDays: 0,
      dropped: [{ channel: 'email', reason: 'no_email' }],
      reason: 'no_channel'
    });

    await db.users.updateOne({ where: { id: OWNER }, data: { email: 'notify-owner@example.com' } });
  });

  it('announces a charge due today on the channels of its first rule and arms nothing', async () => {
    clock = Date.parse(`${DUE_DATE}T11:00:00Z`);
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[announce]', 'announce');

    const { id } = await charge(OWNER, DEBTOR_EMAIL, true);

    equal(sent.pushes.length, 1);
    equal(sent.emails.length, 1);
    deepEqual((await EventRepository.list(db, id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['push', 'email'] });
    equal(notify.events.has(notifyIdentifier(id)), false, 'the notice went out: nothing is left to arm');

    // Without a device the e-mail is the only channel left.
    const plain = await charge(OWNER, undefined, true);

    equal(sent.emails.length, 2);
    equal(sent.emails.at(-1)!.to, plain.address);
    deepEqual((await EventRepository.list(db, plain.id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['email'] });
    equal(notify.events.has(notifyIdentifier(plain.id)), false);

    sent.reset();

    await announceCharges(db, context, [crypto.randomUUID()], clock);

    equal(sent.emails.length, 0);
    equal(sent.pushes.length, 0);
  });

  it('leaves a charge due later to its first reminder', async () => {
    clock = start;
    sent.reset();

    const { id } = await charge(OWNER, undefined, true);

    equal(sent.emails.length + sent.pushes.length, 0);
    deepEqual(await EventRepository.list(db, id, 'notice.sent'), []);
    equal(notify.events.has(notifyIdentifier(id)), false);
  });

  it('reminds on the channels of its rule and arms nothing', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[reminder-push]', 'reminder-push');

    const pushed = await charge(OWNER, DEBTOR_EMAIL);

    // No rule names this offset: nothing configurable goes, only the implicit push.
    deepEqual(await notifyCharge(db, context, pushed.id, NoticeTemplate.Reminder, clock, -3), { channels: ['push'], dropped: [] });
    equal(notify.events.has(notifyIdentifier(pushed.id)), false);

    const mailed = await charge();

    deepEqual(await notifyCharge(db, context, mailed.id, NoticeTemplate.Reminder, clock, -3), { channels: [], dropped: [] });
    equal(notify.events.has(notifyIdentifier(mailed.id)), false);

    // A push nobody accepted leaves the e-mail alone: each channel answers for itself.
    sent.state.pushStatus = 'disabled';

    try {
      deepEqual(await notifyCharge(db, context, pushed.id, NoticeTemplate.Reminder, clock, 0), { channels: ['email'], dropped: [] });
    } finally {
      sent.state.pushStatus = 'accepted';
    }
  });

  it('sends nothing for a charge that is already settled', async () => {
    clock = start;
    sent.reset();

    const paid = await charge(OWNER, DEBTOR_EMAIL);

    await charges.pay(OWNER, paid.id);

    deepEqual(await send(paid.id, NoticeTemplate.Reminder, 0), { channels: [], dropped: [] });
    equal((await EventRepository.list(db, paid.id, 'notice.skipped')).length, 0);
    equal(sent.emails.length + sent.pushes.length, 0);
  });

  it('sends nothing while a payment waits in review and refuses the manual reminder', async () => {
    const { id } = await charge();

    await putProof(id, StoredProofState.Pending, ProofKind.Declaration, new Date(clock).toISOString());

    sent.reset();

    deepEqual(await send(id, NoticeTemplate.Reminder, 0), { channels: [], dropped: [] });
    equal(sent.pushes.length + sent.emails.length, 0);
    equal((await EventRepository.list(db, id, 'notice.skipped'))[0]?.payload['reason'], 'in_review');

    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ChargeInReviewError);

    notify.events.clear();

    await planReminders(db, notify, instantAt(DUE_DATE, REMINDER_HOUR, TZ).getTime() - 3600_000);

    equal(notify.events.has(notifyIdentifier(id)), false);
  });

  it('keeps every automatic notice of a silenced charge quiet and lets the manual reminder through', async () => {
    clock = Date.parse(`${DUE_DATE}T11:00:00Z`);
    sent.reset();

    const quiet = await charge();
    const control = await charge();

    await charges.setNotify(OWNER, quiet.id, false);

    deepEqual(await send(quiet.id, NoticeTemplate.Initial), { channels: [], dropped: [] });
    deepEqual(await send(quiet.id, NoticeTemplate.Reminder, 0), { channels: [], dropped: [] });
    deepEqual(await sendChargeNotice(db, context, quiet.id, NoticeTemplate.Reminder, clock, { offsetDays: 0, channels: PUSH_ONLY }), {
      channels: [],
      dropped: []
    });
    equal(sent.pushes.length + sent.emails.length, 0);

    const skipped = (await EventRepository.list(db, quiet.id, 'notice.skipped')).map((event) => event.payload);

    equal(skipped.length, 3);
    ok(skipped.every((payload) => payload['reason'] === 'silenced'));
    deepEqual(skipped.map((payload) => payload['template']).sort(), ['initial', 'reminder', 'reminder']);
    ok(skipped.some((payload) => payload['offsetDays'] === 0));

    await announceCharges(db, context, [quiet.id], clock);

    equal(sent.pushes.length + sent.emails.length, 0, 'no initial notice for a silenced charge');
    equal(notify.events.has(notifyIdentifier(quiet.id)), false);

    notify.events.clear();

    await planReminders(db, notify, instantAt(DUE_DATE, REMINDER_HOUR, TZ).getTime() - 3600_000);

    equal(notify.events.has(notifyIdentifier(quiet.id)), false);
    ok(notify.events.has(notifyIdentifier(control.id)), 'the charge beside it is still planned');

    const manual = await manualReminder(db, OWNER, quiet.id, context, () => clock);

    ok(manual.channels.length > 0);
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, quiet.address);
  });

  it('never notifies about a registro and refuses its manual reminder', async () => {
    clock = start;
    sent.reset();

    const received = await registroCharge();
    const paid = await registroCharge(Direction.Payable);
    const control = await charge();

    deepEqual(await send(received, NoticeTemplate.Reminder, 0), { channels: [], dropped: [] });
    deepEqual(await send(paid, NoticeTemplate.Reminder, -1), { channels: [], dropped: [] });
    deepEqual(await sendChargeNotice(db, context, received, NoticeTemplate.Manual, clock, { channels: EMAIL_ONLY }), { channels: [], dropped: [] });
    equal(sent.pushes.length + sent.emails.length, 0);

    const skipped = [
      ...(await EventRepository.list(db, received, 'notice.skipped')),
      ...(await EventRepository.list(db, paid, 'notice.skipped'))
    ].map((event) => event.payload);

    equal(skipped.length, 3);
    ok(skipped.every((payload) => payload['reason'] === 'settled'));
    ok(skipped.some((payload) => payload['offsetDays'] === -1));

    const recorded = await db.events.count({ where: { eventable_id: received, type: 'notice.skipped' } });

    await announceCharges(db, context, [received, paid], Date.parse(`${DUE_DATE}T11:00:00Z`));

    equal(
      await db.events.count({ where: { eventable_id: received, type: 'notice.skipped' } }),
      recorded,
      'the initial notice skips a registro without an event'
    );
    equal(sent.pushes.length + sent.emails.length, 0);

    notify.events.clear();

    await planReminders(db, notify, instantAt(DUE_DATE, REMINDER_HOUR, TZ).getTime() - 3600_000);

    equal(notify.events.has(notifyIdentifier(received)), false);
    equal(notify.events.has(notifyIdentifier(paid)), false);
    ok(notify.events.has(notifyIdentifier(control.id)), 'the charge beside them is still planned');

    await rejects(() => manualReminder(db, OWNER, received, context, () => clock), SettledNoRemindersError);
  });

  it('refuses the manual reminder of a registro even with a payment under review', async () => {
    clock = start;

    const reviewing = await registroCharge();

    await putProof(reviewing, StoredProofState.Pending);

    await rejects(() => manualReminder(db, OWNER, reviewing, context, () => clock), SettledNoRemindersError);
  });

  it('never pushes a payment notice to the person whose own action it reports', async () => {
    const { id, userId } = await charge();
    const payments = { transport: sent.transport, origin: 'https://receivy.example' };

    await soleDevice(OWNER, 'ExponentPushToken[owner-self]', 'owner-self');
    await soleDevice(userId, 'ExponentPushToken[debtor-self]', 'debtor-self');
    await putProof(id, StoredProofState.Accepted, ProofKind.File, new Date(clock).toISOString());

    sent.reset();

    // The payer settled it themselves: a confirmation of their own act is nobody's news.
    await pushPaymentNotice(db, payments, id, PaymentNotice.Confirmed, userId);

    equal(sent.pushes.length, 0);

    await pushPaymentNotice(db, payments, id, PaymentNotice.Confirmed, OWNER);

    equal(sent.pushes.length, 1);
    equal(sent.pushes[0]?.token, 'ExponentPushToken[debtor-self]');
    equal(sent.pushes[0]?.title, 'Pagamento confirmado');
  });

  it('pushes who has to answer a declared payment and who paid once it is answered, never twice', async () => {
    const { id, userId } = await charge();
    const payments = { transport: sent.transport, origin: 'https://receivy.example' };

    await soleDevice(OWNER, 'ExponentPushToken[owner-review]', 'owner-review');
    await soleDevice(userId, 'ExponentPushToken[debtor-review]', 'debtor-review');
    await putProof(id, StoredProofState.Pending, ProofKind.Declaration, new Date(clock).toISOString());

    sent.reset();

    await pushPaymentNotice(db, payments, id, PaymentNotice.Declared);
    await pushPaymentNotice(db, payments, id, PaymentNotice.Declared);

    equal(sent.pushes.length, 1, 'the same submission is pushed once');
    equal(sent.pushes[0]?.token, 'ExponentPushToken[owner-review]');
    equal(sent.pushes[0]?.title, 'Pagamento informado');
    ok(/^Recipient disse que pagou .+ · R\$\s12,34\. Confirme o recebimento\.$/.test(sent.pushes[0]?.body ?? ''));
    equal(sent.pushes[0]?.url, `https://receivy.example/charges/${id}`);

    await putProof(id, StoredProofState.Rejected, ProofKind.Declaration, new Date(clock).toISOString(), 'Não caiu');
    await pushPaymentNotice(db, payments, id, PaymentNotice.NotIdentified);

    equal(sent.pushes.length, 2);
    equal(sent.pushes[1]?.token, 'ExponentPushToken[debtor-review]');
    equal(sent.pushes[1]?.title, 'Pagamento não identificado');
    ok(sent.pushes[1]?.body.endsWith(': Não caiu'));
    equal(sent.emails.length, 0, 'payment notices never e-mail');
  });

  it('computes reminder instants at 06:00 of the billing timezone', () => {
    equal(REMINDER_HOUR, 6);
    equal(instantAt(DUE_DATE, REMINDER_HOUR, TZ).toISOString(), '2029-01-04T09:00:00.000Z');
    equal(instantAt('2029-07-04', REMINDER_HOUR, TZ).toISOString(), '2029-07-04T09:00:00.000Z');
    equal(instantAt(DUE_DATE, REMINDER_HOUR, 'America/Manaus').toISOString(), '2029-01-04T10:00:00.000Z');
    equal(instantAt(DUE_DATE, 0, 'UTC').toISOString(), '2029-01-04T00:00:00.000Z');
  });

  it('sends a manual reminder for the creditor only and refuses another one inside twenty-four hours', async () => {
    clock = start;
    sent.reset();

    const { id, address } = await charge();

    await rejects(() => manualReminder(db, OTHER, id, context, () => clock), HttpForbiddenError);
    await rejects(() => manualReminder(db, DEBTOR, id, context, () => clock), HttpForbiddenError);

    const payable = await payableCharge();

    await rejects(() => manualReminder(db, OWNER, payable, context, () => clock), HttpForbiddenError);

    const first = await manualReminder(db, OWNER, id, context, () => clock);

    ok(first.channels.length > 0);
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, address);
    deepEqual((await EventRepository.list(db, id, 'notice.sent'))[0]?.payload, {
      template: 'manual',
      channels: ['email'],
      dropped: [{ channel: 'whatsapp', reason: 'no_phone' }]
    });

    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ReminderQuotaError);

    equal(sent.emails.length, 1);

    clock += DAY + 1;

    const second = await manualReminder(db, OWNER, id, context, () => clock);

    ok(second.channels.length > 0);
    equal(sent.emails.length, 2);

    await charges.pay(OWNER, id);
    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ApiError);
  });

  it('sends a manual reminder on every channel the owner keeps and arms nothing', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[manual-a]', 'manual-a');
    await registerDevice(db, DEBTOR, {
      token: 'ExpoPushToken[manual-b]',
      platform: DevicePlatform.Android,
      installationId: 'manual-b'
    });

    const { id } = await charge(OWNER, DEBTOR_EMAIL);

    const manual = await manualReminder(db, OWNER, id, context, () => clock);

    ok(manual.channels.length > 0);
    deepEqual(sent.pushes.map((push) => push.token).sort(), ['ExpoPushToken[manual-a]', 'ExpoPushToken[manual-b]']);
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, DEBTOR_EMAIL);
    deepEqual((await EventRepository.list(db, id, 'notice.sent'))[0]?.payload, {
      template: 'manual',
      channels: ['push', 'push', 'email'],
      dropped: [{ channel: 'whatsapp', reason: 'no_phone' }]
    });
    equal(notify.events.has(notifyIdentifier(id)), false, 'the creditor pressed the button: nothing to follow up');

    // The quota counts the reminder that reached someone, whatever the channel.
    await rejects(() => manualReminder(db, OWNER, id, context, () => clock), ReminderQuotaError);

    equal(sent.pushes.length, 2);
    equal(sent.emails.length, 1);
  });

  it('previews the manual reminder from the owner manual channels without sending, then sends the same', async () => {
    clock = start;
    sent.reset();

    await soleDevice(DEBTOR, 'ExpoPushToken[manual]', 'manual');
    await accounts.saveReminders(OWNER, { ...SYSTEM_REMINDER_CONFIG, manual: { email: false, whatsapp: true } });

    try {
      const { id } = await charge(OWNER, DEBTOR_EMAIL);

      deepEqual(await notifications.reminderPreview(OWNER, id), { channels: ['push'], dropped: [{ channel: 'whatsapp', reason: 'no_phone' }] });
      equal(sent.pushes.length + sent.emails.length, 0, 'the preview sends nothing');

      deepEqual(await notifications.manualReminder(OWNER, id), { channels: ['push'], dropped: [{ channel: 'whatsapp', reason: 'no_phone' }] });
      equal(sent.emails.length, 0, 'e-mail is off for the manual reminder');
      await rejects(notifications.manualReminder(OWNER, id), ReminderQuotaError);
    } finally {
      await accounts.clearReminders(OWNER);
    }
  });

  it('reports a reminder nobody can receive and leaves the daily quota untouched', async () => {
    clock = start;
    sent.reset();

    const { id, userId } = await charge();

    // The debtor has neither a device nor an address: the attempt is recorded as skipped, not sent.
    await db.users.updateOne({ where: { id: userId }, data: { email: null as unknown as undefined } });
    await noDevices(userId);

    const first = await manualReminder(db, OWNER, id, context, () => clock);

    equal(first.channels.length, 0);

    const second = await manualReminder(db, OWNER, id, context, () => clock);

    equal(second.channels.length, 0, 'a suppressed attempt never blocks the next one');
    equal((await EventRepository.list(db, id, 'notice.sent')).length, 0);
    equal((await EventRepository.list(db, id, 'notice.skipped')).length, 2);
    equal(sent.emails.length, 0);
  });

  it('rotates a device token in place and keeps it active', async () => {
    const input = { token: 'ExpoPushToken[rotation-old]', platform: DevicePlatform.Ios, installationId: 'rotation-device' };
    const device = await soleDevice(DEBTOR, input.token, input.installationId);
    const rotated = await registerDevice(db, DEBTOR, { ...input, token: 'ExpoPushToken[rotation-new]' });

    equal(rotated.id, device.id);
    equal(rotated.active, true);

    const current = await db.device_tokens.findOne({ select: { token: true, active: true }, where: { id: device.id } });

    equal(current?.token, 'ExpoPushToken[rotation-new]');
    equal(current?.active, true);
    ok((await EventRepository.list(db, device.id, 'notifications.device_registered')).length >= 2);
  });

  it('refuses to move a device between accounts', async () => {
    const input = { token: 'ExpoPushToken[account-transfer]', platform: DevicePlatform.Ios, installationId: 'account-transfer' };

    await registerDevice(db, DEBTOR, input);
    await rejects(() => registerDevice(db, OTHER, input), ApiError);
    await rejects(
      () => registerDevice(db, DEBTOR, { ...input, token: 'bad token' }),
      (error: Error & { status?: number }) => error.status === 400
    );
  });

  it('lets the recipient opt out of e-mail through the signed token and opt back in', async () => {
    const { userId } = await charge(OWNER, DEBTOR_EMAIL);
    const token = issueOptOutToken({ userId, email: DEBTOR_EMAIL, secret: TEST_CONFIG.secret });

    deepEqual(await publicLinks.optOut(token), { optedOut: true });
    ok((await AccountRepository.authUser(db, userId)) !== null);

    const row = await db.users.findOne({ select: { email_opt_out_at: true }, where: { id: userId } });

    ok(row?.email_opt_out_at);
    deepEqual(await publicLinks.optIn(token), { optedOut: false });
    await rejects(publicLinks.optOut(`${userId}.bad`), HttpNotFoundError);
  });
});
