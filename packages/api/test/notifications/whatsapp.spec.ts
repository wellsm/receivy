import { deepEqual, equal, ok } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Service } from '@ez4/common';
import { BucketTester } from '@ez4/local-storage/test';
import { BillingRecurrence, PaymentProvider, PixKeyType, SplitMode, SplitPartKind, WhatsappInstanceState, WhatsappMessageStatus, WhatsappSender } from '@receivy/common';
import { createBilling } from '../../src/billings/services/billing';
import { WhatsappInstanceRepository } from '../../src/notifications/repositories/whatsapp-instance';
import { WhatsappMessageRepository } from '../../src/notifications/repositories/whatsapp-message';
import { reminderPreview } from '../../src/notifications/services/notification';
import { NoticeTemplate, notifyCharge } from '../../src/notifications/services/send';
import { AccountRepository } from '../../src/users/repositories/account';
import { type AccountService, createService as createAccountService } from '../../src/users/services/account';
import { cleanupUsers, contacts, createUser, db, grantBasicPlan, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const FREE = 'c2222222-2222-4222-8222-222222222222';
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
  const { records } = await db.whatsapp_messages.findMany({ select: { sender: true, status: true, to: true, provider_message_id: true }, where: { charge_id: chargeId } });

  return records;
}

describe('WhatsApp notices', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'wa-owner@example.com', name: 'Wellington Owner' });
    await createUser(db, { id: FREE, email: 'wa-free@example.com', name: 'Free Owner' });
    await grantBasicPlan(db, OWNER);
    // A charge with no Pix key on file has nothing to publish yet: every fixture charge needs one to clear sendChargeNotice's PixRequired gate.
    await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'wa-owner@example.com' });
    await paymentMethods.save(FREE, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'wa-free@example.com' });
    await accounts.saveReminders(OWNER, WHATSAPP_ONLY);
    await accounts.saveReminders(FREE, WHATSAPP_ONLY);
  });

  after(async () => {
    await cleanupUsers(db, [OWNER, FREE]);
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
});
