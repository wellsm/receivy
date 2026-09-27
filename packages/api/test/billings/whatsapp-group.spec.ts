import { deepEqual, equal, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { type BillingInput, BillingKind, BillingRecurrence, PaymentProvider, PixKeyType, SplitMode, SplitPartKind, WhatsappInstanceState } from '@receivy/common';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { getBilling } from '../../src/billings/services/detail';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ApiError } from '../../src/common/errors';
import { WhatsappInstanceRepository } from '../../src/notifications/repositories/whatsapp-instance';
import { cleanupUsers, contacts, createUser, db, paymentMethods } from '../fixtures/financial';

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
});
