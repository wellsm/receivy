import { deepEqual, equal, match, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { type BillingInput, BillingKind, type BillingSplit, BillingRecurrence, PaymentProvider, PixKeyType, SplitMode, SplitPartKind, WhatsappInstanceState } from '@receivy/common';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { getBilling } from '../../src/billings/services/detail';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ApiError } from '../../src/common/errors';
import { WhatsappInstanceRepository } from '../../src/notifications/repositories/whatsapp-instance';
import { NoticeTemplate, notifyCharge, sendChargeNotice } from '../../src/notifications/services/send';
import { cleanupUsers, contacts, createUser, db, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = 'e5111111-1111-4111-8111-111111111111';
const GROUP = { jid: '120363000000000002@g.us', name: 'Creche Pet' };

let debtorId: string;
let payeeId: string;
let pixId: string;
let instanceId: string;

function once(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    recurrence: BillingRecurrence.Once,
    description: 'Creche',
    totalCents: 30_000,
    startDate: '2026-12-01',
    timezone: 'America/Sao_Paulo',
    paymentMethodId: pixId,
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: debtorId }] },
    ...overrides
  };
}

async function refusedFor(run: () => Promise<unknown>, code: string) {
  await rejects(run, (error: unknown) => error instanceof ApiError && (error as ApiError & { context?: { code?: string } }).context?.code === code);
}

describe('billings notified in a WhatsApp group', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'group-owner@example.com', name: 'Creche' });

    debtorId = (await contacts.save(OWNER, { name: 'Well', email: 'group-debtor@example.com' })).userId;
    payeeId = (await contacts.save(OWNER, { name: 'Fornecedor', email: 'group-payee@example.com' })).id;
    pixId = (await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '52998224725' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER]));

  it('refuses a group while the owner has no connected number', async () => {
    await refusedFor(() => createBilling(db, OWNER, 'group-no-instance', once({ whatsappGroup: GROUP })), 'WHATSAPP_INSTANCE_REQUIRED');

    const now = new Date().toISOString();

    instanceId = (await WhatsappInstanceRepository.insert(db, { ownerId: OWNER, name: `rcv_${OWNER}`, token: 't', webhookSecret: 's', now })).id;

    // Pending is not connected yet.
    await refusedFor(() => createBilling(db, OWNER, 'group-pending', once({ whatsappGroup: GROUP })), 'WHATSAPP_INSTANCE_REQUIRED');

    await WhatsappInstanceRepository.setState(db, instanceId, { state: WhatsappInstanceState.Open }, now);
  });

  it('stores the group of a conta a receber, shows it and lets it be dropped', async () => {
    const created = await createBilling(db, OWNER, 'group-create', once({ whatsappGroup: { ...GROUP, name: '  Creche Pet ' } }));

    deepEqual(created.whatsappGroup, GROUP);
    equal(created.whatsappGroupFailing, false);

    const cleared = await patchBilling(db, OWNER, created.id, { clearWhatsappGroup: true });

    equal(cleared.whatsappGroup, null);

    const moved = await patchBilling(db, OWNER, created.id, { whatsappGroup: { jid: '120363000000000009@g.us', name: 'Casa' } });

    deepEqual(moved.whatsappGroup, { jid: '120363000000000009@g.us', name: 'Casa' });
  });

  it('clears the failure mark when the owner picks a group again', async () => {
    const created = await createBilling(db, OWNER, 'group-failing', once({ whatsappGroup: GROUP }));

    await BillingRepository.update(db, created.id, { whatsappGroupFailedAt: new Date().toISOString() }, new Date().toISOString());

    equal((await getBilling(db, OWNER, created.id)).whatsappGroupFailing, true);
    equal((await patchBilling(db, OWNER, created.id, { whatsappGroup: GROUP })).whatsappGroupFailing, false);
  });

  it('never takes a group on a conta a pagar or a registro, nor a jid that is not a group', async () => {
    await rejects(() => createBilling(db, OWNER, 'group-payable', { ...once({ whatsappGroup: GROUP }), split: undefined, contactId: payeeId, paymentMethodId: undefined }), RangeError);
    await rejects(() => createBilling(db, OWNER, 'group-record', once({ whatsappGroup: GROUP, kind: BillingKind.Record, paymentMethodId: undefined })), RangeError);
    await rejects(() => createBilling(db, OWNER, 'group-jid', once({ whatsappGroup: { jid: '5511999999999@s.whatsapp.net', name: 'Ana' } })), RangeError);

    const payable = await createBilling(db, OWNER, 'group-payable-ok', { ...once(), split: undefined, contactId: payeeId, paymentMethodId: undefined });

    await rejects(() => patchBilling(db, OWNER, payable.id, { whatsappGroup: GROUP }), RangeError);
  });

  describe('sending to the group', () => {
    let secondId: string;

    before(async () => {
      secondId = (await contacts.save(OWNER, { name: 'Bia Souza', email: 'group-second@example.com' })).userId;
    });

    function split(): BillingSplit {
      return {
        mode: SplitMode.Fixed,
        parts: [
          { kind: SplitPartKind.User, userId: debtorId, amountCents: 20_000 },
          { kind: SplitPartKind.User, userId: secondId, amountCents: 10_000 }
        ]
      };
    }

    it('tells the group once per due date, one line and one short link per person, and nobody in private', async () => {
      const { context, sent } = fakeNotice();
      const billing = await createBilling(db, OWNER, 'group-send', once({ whatsappGroup: GROUP, split: split() }));
      const [first, second] = billing.charges;

      deepEqual(await notifyCharge(db, context, first!.id, NoticeTemplate.Reminder, Date.now(), 0), { channels: ['whatsapp'], dropped: [] });
      deepEqual(await notifyCharge(db, context, second!.id, NoticeTemplate.Reminder, Date.now(), 0), { channels: ['whatsapp'], dropped: [] });

      equal(sent.whatsapps.length, 1);
      equal(sent.whatsapps[0]!.to, GROUP.jid);
      equal(sent.whatsapps[0]!.sender, 'own');
      equal(sent.whatsapps[0]!.instance, `rcv_${OWNER}`);
      match(sent.whatsapps[0]!.text, /^Lembrete · Creche vence em 01\/dez:/);
      match(sent.whatsapps[0]!.text, /• Well R\$ 200,00 https:\/\/receivy\.example\/p\/[1-9A-HJ-NP-Za-km-z]{9}/);
      match(sent.whatsapps[0]!.text, /• Bia R\$ 100,00 https:\/\/receivy\.example\/p\/[1-9A-HJ-NP-Za-km-z]{9}/);
      equal(sent.emails.length, 0);
      equal(sent.pushes.length, 0);
    });

    it('reminds one person by name in the group', async () => {
      const { context, sent } = fakeNotice();
      const billing = await createBilling(db, OWNER, 'group-manual', once({ whatsappGroup: GROUP, split: split() }));
      const second = billing.charges.find((charge) => charge.amount.amountCents === 10_000)!;

      deepEqual(await sendChargeNotice(db, context, second.id, NoticeTemplate.Manual, Date.now(), { channels: { email: true, whatsapp: false } }), { channels: ['whatsapp'], dropped: [] });

      equal(sent.whatsapps.length, 1);
      match(sent.whatsapps[0]!.text, /^Bia, falta R\$ 100,00 de Creche: https:\/\/receivy\.example\/p\//);
    });

    it('falls back to each person and marks the billing when the group cannot be told', async () => {
      const { context, sent } = fakeNotice();
      const billing = await createBilling(db, OWNER, 'group-fallback', once({ whatsappGroup: GROUP, split: split() }));

      sent.state.whatsappStatus = 'permanent';

      const result = await notifyCharge(db, context, billing.charges[0]!.id, NoticeTemplate.Reminder, Date.now(), 0);

      deepEqual(result.channels, ['email']);
      equal(sent.emails.length, 1);
      equal((await getBilling(db, OWNER, billing.id)).whatsappGroupFailing, true);

      // The next group notice that gets through clears the mark.
      sent.state.whatsappStatus = 'accepted';

      await notifyCharge(db, context, billing.charges[1]!.id, NoticeTemplate.Reminder, Date.now(), 0);

      equal((await getBilling(db, OWNER, billing.id)).whatsappGroupFailing, false);
      ok(sent.whatsapps.some((message) => message.to === GROUP.jid));
    });
  });
});

