import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { BillingInput } from '@receivy/common';
import { createBilling, getBilling, listBillings, patchBilling } from '../../src/billings/repositories/billing';
import { cancelCharge, getCharge, payCharge } from '../../src/charges/repositories/charge';
import { ApiError } from '../../src/common/errors';
import { saveContact } from '../../src/contacts/repositories/contact';
import { createInvite } from '../../src/invites/services/links';
import { createOrRotatePublicLink } from '../../src/public/repositories/public-link';
import { getContactLedger, getTimeline } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const PAYEE = 'c2222222-2222-4222-8222-222222222222';
const SECRET = 'payable-spec-secret-with-enough-length-0123456789';

let payeeContactId: string;

function payable(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: 'once',
    direction: 'payable',
    description: 'Aluguel',
    totalCents: 150_000,
    startDate: '2026-11-05',
    timezone: 'America/Sao_Paulo',
    pix: { keyType: 'email', key: 'Imobiliaria@Example.com', label: 'Imobiliária' },
    ...overrides
  };
}

describe('contas a pagar on native PostgreSQL', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'payable-owner@example.com', name: 'Dona' });
    await createUser(db, { id: PAYEE, email: 'payable-payee@example.com', name: 'Credora' });
    payeeContactId = (await saveContact(db, OWNER, { name: 'Credora', email: 'payable-payee@example.com', nickname: 'Imobiliária' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYEE]));

  it('creates a bill that is the owner alone: one owner-paid charge, no wallet key, no participants', async () => {
    const created = await createBilling(db, OWNER, 'payable-alone', payable({ description: 'Netflix', totalCents: 3_990, pix: undefined }));

    equal(created.direction, 'payable');
    equal(created.payee, null);
    equal(created.pix, null);
    ok(!created.paymentMethodId);
    deepEqual(created.split, { mode: 'equal', parts: [{ kind: 'owner' }] });
    equal(created.charges.length, 1);

    const charge = created.charges[0]!;

    equal(charge.direction, 'payable');
    equal(charge.payer, 'owner');
    equal(charge.ownedByViewer, true);
    equal(charge.hasPix, false);
    equal(charge.counterpartName, 'Você');
    equal(charge.sharingState, 'closed');
    equal(charge.amount.amountCents, 3_990);

    const summary = (await listBillings(db, OWNER, { direction: 'payable' })).billings.find((row) => row.id === created.id);

    equal(summary?.direction, 'payable');
    equal(summary?.payeeName, null);
    ok(!(await listBillings(db, OWNER, { direction: 'receivable' })).billings.some((row) => row.id === created.id));
  });

  it('rejects contacts, wallet keys and invalid typed keys on a conta a pagar', async () => {
    await rejects(
      () =>
        createBilling(
          db,
          OWNER,
          'payable-split',
          payable({ split: { mode: 'fixed', parts: [{ kind: 'user', userId: PAYEE, amountCents: 1 }] } })
        ),
      /não divide o valor/
    );
    await rejects(
      () => createBilling(db, OWNER, 'payable-wallet', payable({ paymentMethodId: 'a1111111-1111-4111-8111-111111111111' })),
      /quem recebe/
    );
    await rejects(
      () => createBilling(db, OWNER, 'payable-bad-pix', payable({ pix: { keyType: 'cpf', key: '123' } })),
      /Chave Pix inválida/
    );
  });

  it('shows the payee the same charge as receivable, with settle powers only', async () => {
    const created = await createBilling(db, OWNER, 'payable-payee', payable({ payeeUserId: PAYEE }));
    const chargeId = created.charges[0]!.id;

    equal(created.payee?.userId, PAYEE);
    deepEqual(created.pix, { keyType: 'email', key: 'imobiliaria@example.com', label: 'Imobiliária' });
    equal(created.charges[0]!.counterpartName, 'Imobiliária');
    equal(created.charges[0]!.hasPix, true);

    const seenByPayee = await getCharge(db, PAYEE, chargeId);

    equal(seenByPayee.direction, 'receivable');
    equal(seenByPayee.payer, 'owner');
    equal(seenByPayee.ownedByViewer, false);
    equal(seenByPayee.counterpartName, 'Dona');
    equal(seenByPayee.sharingState, 'closed');

    // The billing itself stays owner-scoped.
    await rejects(() => getBilling(db, PAYEE, created.id), HttpNotFoundError);
    await rejects(() => patchBilling(db, PAYEE, created.id, { state: 'ended' }), HttpNotFoundError);
    await rejects(() => cancelCharge(db, PAYEE, chargeId), HttpForbiddenError);
    await rejects(() => createOrRotatePublicLink(db, PAYEE, chargeId, SECRET), HttpForbiddenError);
    await rejects(() => createOrRotatePublicLink(db, OWNER, chargeId, SECRET), HttpForbiddenError);
    await rejects(() => createInvite(db, OWNER, created.id, SECRET, 'https://receivy.test'), ApiError);
    // The owner ends the conta as a whole; a single occurrence is never cancelled.
    await rejects(() => cancelCharge(db, OWNER, chargeId), HttpForbiddenError);

    const payeeTimeline = await getTimeline(db, PAYEE, { direction: ['receivable'] });
    const ownerTimeline = await getTimeline(db, OWNER, { direction: ['payable'] });

    ok(payeeTimeline.items.some((item) => item.kind === 'charge' && item.charge.id === chargeId && item.direction === 'receivable'));
    ok(ownerTimeline.items.some((item) => item.kind === 'charge' && item.charge.id === chargeId && item.direction === 'payable'));
    equal(ownerTimeline.summary.payableCount >= 1, true);
    ok(
      !(await getTimeline(db, OWNER, { direction: ['receivable'] })).items.some(
        (item) => item.kind === 'charge' && item.charge.id === chargeId
      )
    );

    const ledger = await getContactLedger(db, OWNER, payeeContactId);

    equal(ledger.payable.amountCents, 150_000);
    equal(ledger.balance.amountCents, -150_000);

    const settled = await payCharge(db, PAYEE, chargeId);

    equal(settled.state, 'paid');
    equal(settled.direction, 'receivable');
  });

  it('lets the owner settle their own bill and swap the typed key', async () => {
    const created = await createBilling(
      db,
      OWNER,
      'payable-self-settle',
      payable({ type: 'indefinite', frequency: 'monthly', startDate: '2099-01-05', description: 'Assinatura' })
    );

    const patched = await patchBilling(db, OWNER, created.id, { pix: { keyType: 'cpf', key: '529.982.247-25', label: 'Nova' } });

    deepEqual(patched.pix, { keyType: 'cpf', key: '52998224725', label: 'Nova' });
    equal((await patchBilling(db, OWNER, created.id, { clearPix: true })).pix, null);
    await rejects(() => patchBilling(db, OWNER, created.id, { paymentMethodId: 'a1111111-1111-4111-8111-111111111111' }), ApiError);

    const once = await createBilling(
      db,
      OWNER,
      'payable-self-once',
      payable({ description: 'Luz', totalCents: 12_000, payeeUserId: undefined })
    );
    const settled = await payCharge(db, OWNER, once.charges[0]!.id);

    equal(settled.state, 'paid');
    equal(settled.direction, 'payable');
    equal(settled.ownedByViewer, true);
  });
});

describe('assinatura due date on native PostgreSQL', () => {
  const OWNER2 = 'c3333333-3333-4333-8333-333333333333';

  before(async () => createUser(db, { id: OWNER2, email: 'due-owner@example.com', name: 'Dona' }));
  after(async () => cleanupUsers(db, [OWNER2]));

  it('materializes an assinatura due today at creation and moves the next due date on patch', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await createBilling(db, OWNER2, 'due-today', {
      type: 'indefinite',
      frequency: 'monthly',
      direction: 'payable',
      description: 'Academia',
      totalCents: 9_900,
      startDate: today,
      timezone: 'UTC'
    });

    equal(created.charges.length, 1, 'the first occurrence is a real charge, not a preview');
    equal(created.charges[0]!.dueDate, today);

    const next = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const patched = await patchBilling(db, OWNER2, created.id, { startDate: next });

    equal(patched.startDate, next);
    equal(patched.charges.length, 1, 'generated occurrences keep their due date');
    equal(patched.previews[0]?.occurrenceDate, next);
    await rejects(() => patchBilling(db, OWNER2, created.id, { startDate: '2020-01-01' }), /passado/);
  });
});
