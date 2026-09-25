import { deepEqual, equal, ok } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Service } from '@ez4/common';
import { BucketTester } from '@ez4/local-storage/test';
import { BillingRecurrence, PaymentProvider, PixKeyType, SplitMode, SplitPartKind, WhatsappInstanceState, WhatsappMessageStatus, WhatsappSender } from '@receivy/common';
import { createBilling } from '../../src/billings/services/billing';
import { WhatsappInstanceRepository } from '../../src/notifications/repositories/whatsapp-instance';
import { WhatsappMessageRepository } from '../../src/notifications/repositories/whatsapp-message';
import { reminderPreview } from '../../src/notifications/services/notification';
import { NoticeChannel, NoticeTemplate, notifyCharge } from '../../src/notifications/services/send';
import { cycleOf, whatsappReach } from '../../src/notifications/services/whatsapp-quota';
import { SubscriptionRepository } from '../../src/plans/repositories/subscription';
import { AccountRepository } from '../../src/users/repositories/account';
import { type AccountService, createService as createAccountService } from '../../src/users/services/account';
import { cleanupUsers, contacts, createUser, db, grantBasicPlan, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const FREE = 'c2222222-2222-4222-8222-222222222222';
const COUNTED = 'c3333333-3333-4333-8333-333333333333';
const EXHAUSTED = 'c4444444-4444-4444-8444-444444444444';
const DUE_DATE = '2029-01-04';
const TZ = 'America/Sao_Paulo';
const clock = Date.parse('2029-01-04T11:00:00Z');
const WHATSAPP_ONLY = { reminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: true } }], manual: { email: false, whatsapp: true } };

const notice = fakeNotice({ whatsappAvailable: true });
const { context, sent } = notice;
const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
const accounts = createAccountService({ db, avatarFiles: bucket, proofFiles: bucket } as unknown as Service.Context<AccountService>);

let count = 0;

/** A once charge to a contact filed with a phone and the consent flag. */
async function charge(owner: string, consent = true) {
  count++;

  const contact = await contacts.save(owner, { name: `Devedor ${count}`, email: `wa-${count}@example.com`, phone: '(11) 99999-0000', whatsappConsent: consent });
  const billing = await createBilling(
    db,
    owner,
    `wa-${count}`,
    {
      recurrence: BillingRecurrence.Once,
      description: 'Aluguel de outubro',
      totalCents: 62000,
      startDate: DUE_DATE,
      timezone: TZ,
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: contact.userId, amountCents: 62000 }] }
    },
    new Date(clock)
  );

  return { id: billing.charges[0]!.id, userId: contact.userId };
}

async function messages(chargeId: string) {
  const { records } = await db.whatsapp_messages.findMany({ select: { sender: true, status: true, to: true, provider_message_id: true, notice_key: true }, where: { charge_id: chargeId } });

  return records;
}

/** A message row written straight through the repository, as the send path would leave it. */
async function ledger(owner: string, chargeId: string, sender: WhatsappSender, noticeKey: string, now: string) {
  return WhatsappMessageRepository.insert(db, { ownerId: owner, chargeId, to: '5511999990000', sender, template: NoticeTemplate.Reminder, noticeKey, now });
}

describe('WhatsApp notices', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'wa-owner@example.com', name: 'Wellington Owner' });
    await createUser(db, { id: FREE, email: 'wa-free@example.com', name: 'Free Owner' });
    await createUser(db, { id: COUNTED, email: 'wa-counted@example.com', name: 'Counted Owner' });
    await createUser(db, { id: EXHAUSTED, email: 'wa-exhausted@example.com', name: 'Exhausted Owner' });
    await grantBasicPlan(db, OWNER);
    await grantBasicPlan(db, COUNTED);
    await grantBasicPlan(db, EXHAUSTED);
    // A charge with no Pix key on file has nothing to publish yet: every fixture charge needs one to clear sendChargeNotice's PixRequired gate.
    await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'wa-owner@example.com' });
    await paymentMethods.save(FREE, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'wa-free@example.com' });
    await paymentMethods.save(EXHAUSTED, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'wa-exhausted@example.com' });
    await accounts.saveReminders(OWNER, WHATSAPP_ONLY);
    await accounts.saveReminders(FREE, WHATSAPP_ONLY);
    await accounts.saveReminders(EXHAUSTED, WHATSAPP_ONLY);
  });

  after(async () => {
    await cleanupUsers(db, [OWNER, FREE, COUNTED, EXHAUSTED]);
  });

  it('sends the template through the Receivy number next to the e-mail and records the row', async () => {
    sent.reset();

    const { id } = await charge(OWNER);

    deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: ['whatsapp', 'email'], dropped: [] });
    equal(sent.whatsapps.length, 1);
    equal(sent.whatsapps[0]!.to, '5511999990000');
    equal(sent.whatsapps[0]!.sender, WhatsappSender.Receivy);
    equal(sent.whatsapps[0]!.template, 'receivy_charge_reminder');
    ok(sent.whatsapps[0]!.text.includes('Aluguel de outubro'));
    equal(sent.emails.length, 1, 'e-mail and WhatsApp are independent: the rule asked for both');

    const rows = await messages(id);

    equal(rows.length, 1);
    equal(rows[0]!.status, WhatsappMessageStatus.Sent);
    equal(rows[0]!.provider_message_id, 'wamid-1');
  });

  it('sends a retried reminder once and still counts WhatsApp as reached', async () => {
    sent.reset();

    const { id } = await charge(OWNER);
    const first = await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0);
    // The scheduler retries the same event after something threw past the accepted send.
    const second = await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0);

    ok(first.channels.includes(NoticeChannel.WhatsApp));
    ok(second.channels.includes(NoticeChannel.WhatsApp), 'the message did leave on the first try');
    equal(sent.whatsapps.length, 1, 'the retry never calls the provider again');
    equal(sent.whatsapps[0]!.key, `${id}:reminder:0`);

    const rows = await messages(id);

    equal(rows.length, 1);
    equal(rows[0]!.notice_key, `${id}:reminder:0`);
  });

  it('keeps a failed row and reports only the e-mail when the provider refuses', async () => {
    sent.reset();
    sent.state.whatsappStatus = 'permanent';

    try {
      const { id } = await charge(OWNER);

      deepEqual(await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0), { channels: ['email'], dropped: [] });
      equal((await messages(id))[0]!.status, WhatsappMessageStatus.Failed);
    } finally {
      sent.state.whatsappStatus = 'accepted';
    }
  });

  it('drops the channel without consent and on the free plan quota', async () => {
    sent.reset();

    const noConsent = await charge(OWNER, false);

    deepEqual((await notifyCharge(db, context, noConsent.id, NoticeTemplate.Reminder, clock, 0)).dropped, [{ channel: 'whatsapp', reason: 'no_consent' }]);

    const free = await charge(FREE);

    deepEqual((await notifyCharge(db, context, free.id, NoticeTemplate.Reminder, clock, 0)).dropped, [{ channel: 'whatsapp', reason: 'quota' }]);
    equal(sent.whatsapps.length, 0);
    equal((await messages(free.id)).length, 0, 'a dropped channel writes no row');
  });

  it('routes the own sender through its instance and drops with sender_offline when it is closed', async () => {
    sent.reset();

    const now = new Date(clock).toISOString();
    const instance = await WhatsappInstanceRepository.insert(db, { ownerId: OWNER, name: `rcv_${OWNER}`, token: 'tok', webhookSecret: 'sec', now });

    await WhatsappInstanceRepository.setState(db, instance.id, { state: WhatsappInstanceState.Open, phone: '5511988887777', connectedAt: now }, now);
    await AccountRepository.setWhatsappSender(db, OWNER, WhatsappSender.Own, now);

    try {
      const open = await charge(OWNER);

      deepEqual(await notifyCharge(db, context, open.id, NoticeTemplate.Reminder, clock, 0), { channels: ['whatsapp', 'email'], dropped: [] });
      equal(sent.whatsapps[0]!.sender, WhatsappSender.Own);
      equal(sent.whatsapps[0]!.instance, `rcv_${OWNER}`);
      equal((await messages(open.id))[0]!.sender, WhatsappSender.Own);

      await WhatsappInstanceRepository.setState(db, instance.id, { state: WhatsappInstanceState.Closed, disconnectedAt: now }, now);

      const closed = await charge(OWNER);

      deepEqual(await notifyCharge(db, context, closed.id, NoticeTemplate.Reminder, clock, 0), { channels: ['email'], dropped: [{ channel: 'whatsapp', reason: 'sender_offline' }] });
      deepEqual(await reminderPreview(db, OWNER, closed.id, context), { channels: [], dropped: [{ channel: 'whatsapp', reason: 'sender_offline' }] });
    } finally {
      await AccountRepository.setWhatsappSender(db, OWNER, WhatsappSender.Receivy, now);
      await WhatsappInstanceRepository.remove(db, instance.id);
    }
  });

  it('exposes the sender and the instance on the reminder settings', async () => {
    const settings = await accounts.reminders(OWNER);

    deepEqual(settings.whatsapp, { available: false, sender: WhatsappSender.Receivy, instance: null });
    equal(settings.whatsappAvailable, false);
  });

  it('advances a message status from the webhook and never regresses it', async () => {
    // No `sent.reset()` here: the fake transport ids messages as `wamid-${whatsapps.length}`, and every
    // earlier test in this file resets and sends once, so a reset would hand this charge the same
    // `wamid-1` a previous test's row already carries. `applyStatus` looks a row up by
    // `provider_message_id` alone (no charge scoping), so a collision would let this test update someone
    // else's row instead of its own. Not resetting keeps the counter climbing past every id already in use.
    const { id } = await charge(OWNER);

    await notifyCharge(db, context, id, NoticeTemplate.Reminder, clock, 0);

    const [row] = await messages(id);
    const now = new Date(clock).toISOString();

    equal(await WhatsappMessageRepository.applyStatus(db, row!.provider_message_id!, WhatsappMessageStatus.Read, undefined, now), true);
    equal(await WhatsappMessageRepository.applyStatus(db, row!.provider_message_id!, WhatsappMessageStatus.Delivered, undefined, now), false);
    equal(await WhatsappMessageRepository.applyStatus(db, 'wamid.nobody', WhatsappMessageStatus.Delivered, undefined, now), false);
    equal((await messages(id))[0]!.status, WhatsappMessageStatus.Read);
    equal(await WhatsappMessageRepository.applyStatus(db, row!.provider_message_id!, WhatsappMessageStatus.Failed, '131026: gone', now), true);
    equal((await messages(id))[0]!.status, WhatsappMessageStatus.Failed);
  });

  it('counts only live Receivy-number rows inside the cycle against the quota', async () => {
    const mid = new Date('2029-01-15T12:00:00Z');
    const now = mid.toISOString();
    const before = '2028-11-15T12:00:00.000Z';
    const subscription = await SubscriptionRepository.get(db, COUNTED);
    const cycle = cycleOf(subscription?.current_period_end ?? null, mid);

    deepEqual(cycle, { from: '2029-01-01T00:00:00.000Z', to: '2029-02-01T00:00:00.000Z' });

    const { id } = await charge(COUNTED);
    const counted = await ledger(COUNTED, id, WhatsappSender.Receivy, 'quota:sent', now);
    const failed = await ledger(COUNTED, id, WhatsappSender.Receivy, 'quota:failed', now);
    const own = await ledger(COUNTED, id, WhatsappSender.Own, 'quota:own', now);
    const earlier = await ledger(COUNTED, id, WhatsappSender.Receivy, 'quota:earlier', before);

    await WhatsappMessageRepository.markSent(db, counted.id, 'wamid-quota-sent', now);
    await WhatsappMessageRepository.markFailed(db, failed.id, 'permanent', now);
    await WhatsappMessageRepository.markSent(db, own.id, 'wamid-quota-own', now);
    await WhatsappMessageRepository.markSent(db, earlier.id, 'wamid-quota-earlier', before);

    const reach = await whatsappReach(db, COUNTED, mid);

    equal(reach.quotaLimit, 150);
    equal(reach.quotaLeft, 150 - 1, 'failed, own-number and last-cycle rows cost nothing');
  });

  it('drops WhatsApp with quota once the cycle spent every Receivy-number message', async () => {
    const now = new Date(clock).toISOString();
    const filler = await charge(EXHAUSTED);

    for (let index = 0; index < 150; index++) {
      const row = await ledger(EXHAUSTED, filler.id, WhatsappSender.Receivy, `exhausted:${index}`, now);

      await WhatsappMessageRepository.markSent(db, row.id, `wamid-exhausted-${index}`, now);
    }

    sent.reset();

    const fresh = await charge(EXHAUSTED);

    deepEqual((await notifyCharge(db, context, fresh.id, NoticeTemplate.Reminder, clock, 0)).dropped, [{ channel: 'whatsapp', reason: 'quota' }]);
    equal(sent.whatsapps.length, 0);
    equal((await messages(fresh.id)).length, 0, 'a dropped channel writes no row');
  });
});
