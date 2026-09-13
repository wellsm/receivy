import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import {
  BillingFrequency,
  type BillingInput,
  BillingState,
  BillingType,
  Direction,
  PixKeyType,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { ApiError } from '../../src/common/errors';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { createInvite } from '../../src/invites/services/links';
import { PublicLinkRepository } from '../../src/public/repositories/public-link';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const PAYEE = 'c2222222-2222-4222-8222-222222222222';
const SECRET = 'payable-spec-secret-with-enough-length-0123456789';

let payeeContactId: string;

function payable(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Once,
    direction: Direction.Payable,
    description: 'Aluguel',
    totalCents: 150_000,
    startDate: '2026-11-05',
    timezone: 'America/Sao_Paulo',
    pix: { keyType: PixKeyType.Email, key: 'Imobiliaria@Example.com', label: 'Imobiliária' },
    ...overrides
  };
}

describe('contas a pagar on native PostgreSQL', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'payable-owner@example.com', name: 'Dona' });
    await createUser(db, { id: PAYEE, email: 'payable-payee@example.com', name: 'Credora' });
    payeeContactId = (
      await ContactRepository.save(db, OWNER, { name: 'Credora', email: 'payable-payee@example.com', nickname: 'Imobiliária' })
    ).id;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYEE]));

  it('creates a bill that is the owner alone: one owner-paid charge, no wallet key, no participants', async () => {
    const created = await BillingRepository.create(
      db,
      OWNER,
      'payable-alone',
      payable({ description: 'Netflix', totalCents: 3_990, pix: undefined })
    );

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

    const summary = (await BillingRepository.list(db, OWNER, { direction: Direction.Payable })).billings.find(
      (row) => row.id === created.id
    );

    equal(summary?.direction, 'payable');
    equal(summary?.payeeName, null);
    ok(!(await BillingRepository.list(db, OWNER, { direction: Direction.Receivable })).billings.some((row) => row.id === created.id));
  });

  it('rejects contacts, wallet keys and invalid typed keys on a conta a pagar', async () => {
    await rejects(
      () =>
        BillingRepository.create(
          db,
          OWNER,
          'payable-split',
          payable({ split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: PAYEE, amountCents: 1 }] } })
        ),
      /não divide o valor/
    );
    await rejects(
      () => BillingRepository.create(db, OWNER, 'payable-wallet', payable({ paymentMethodId: 'a1111111-1111-4111-8111-111111111111' })),
      /quem recebe/
    );
    await rejects(
      () => BillingRepository.create(db, OWNER, 'payable-bad-pix', payable({ pix: { keyType: PixKeyType.Cpf, key: '123' } })),
      /Chave Pix inválida/
    );
  });

  it('shows the payee the same charge as receivable, with settle powers only', async () => {
    const created = await BillingRepository.create(db, OWNER, 'payable-payee', payable({ payeeUserId: PAYEE }));
    const chargeId = created.charges[0]!.id;

    equal(created.payee?.userId, PAYEE);
    deepEqual(created.pix, { keyType: PixKeyType.Email, key: 'imobiliaria@example.com', label: 'Imobiliária' });
    equal(created.charges[0]!.counterpartName, 'Imobiliária');
    equal(created.charges[0]!.hasPix, true);

    const seenByPayee = await ChargeRepository.get(db, PAYEE, chargeId);

    equal(seenByPayee.direction, 'receivable');
    equal(seenByPayee.payer, 'owner');
    equal(seenByPayee.ownedByViewer, false);
    equal(seenByPayee.counterpartName, 'Dona');
    equal(seenByPayee.sharingState, 'closed');

    // The billing itself stays owner-scoped.
    await rejects(() => BillingRepository.get(db, PAYEE, created.id), HttpNotFoundError);
    await rejects(() => BillingRepository.patch(db, PAYEE, created.id, { state: BillingState.Ended }), HttpNotFoundError);
    await rejects(() => ChargeRepository.cancel(db, PAYEE, chargeId), HttpForbiddenError);
    await rejects(() => PublicLinkRepository.createOrRotate(db, PAYEE, chargeId, SECRET), HttpForbiddenError);
    await rejects(() => PublicLinkRepository.createOrRotate(db, OWNER, chargeId, SECRET), HttpForbiddenError);
    await rejects(() => createInvite(db, OWNER, created.id, SECRET, 'https://receivy.test'), ApiError);
    // The owner ends the conta as a whole; a single occurrence is never cancelled.
    await rejects(() => ChargeRepository.cancel(db, OWNER, chargeId), HttpForbiddenError);

    const payeeTimeline = await TimelineRepository.get(db, PAYEE, { direction: [Direction.Receivable] });
    const ownerTimeline = await TimelineRepository.get(db, OWNER, { direction: [Direction.Payable] });

    ok(payeeTimeline.items.some((item) => item.kind === 'charge' && item.charge.id === chargeId && item.direction === 'receivable'));
    ok(ownerTimeline.items.some((item) => item.kind === 'charge' && item.charge.id === chargeId && item.direction === 'payable'));
    equal(ownerTimeline.summary.payableCount >= 1, true);
    ok(
      !(await TimelineRepository.get(db, OWNER, { direction: [Direction.Receivable] })).items.some(
        (item) => item.kind === 'charge' && item.charge.id === chargeId
      )
    );

    const ledger = await TimelineRepository.contactLedger(db, OWNER, payeeContactId);

    equal(ledger.payable.amountCents, 150_000);
    equal(ledger.balance.amountCents, -150_000);

    const settled = await ChargeRepository.pay(db, PAYEE, chargeId);

    equal(settled.state, 'paid');
    equal(settled.direction, 'receivable');
  });

  it('lets the owner settle their own bill and swap the typed key', async () => {
    const created = await BillingRepository.create(
      db,
      OWNER,
      'payable-self-settle',
      payable({ type: BillingType.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2099-01-05', description: 'Assinatura' })
    );

    const patched = await BillingRepository.patch(db, OWNER, created.id, {
      pix: { keyType: PixKeyType.Cpf, key: '529.982.247-25', label: 'Nova' }
    });

    deepEqual(patched.pix, { keyType: PixKeyType.Cpf, key: '52998224725', label: 'Nova' });
    equal((await BillingRepository.patch(db, OWNER, created.id, { clearPix: true })).pix, null);
    await rejects(
      () => BillingRepository.patch(db, OWNER, created.id, { paymentMethodId: 'a1111111-1111-4111-8111-111111111111' }),
      ApiError
    );

    const once = await BillingRepository.create(
      db,
      OWNER,
      'payable-self-once',
      payable({ description: 'Luz', totalCents: 12_000, payeeUserId: undefined })
    );
    const settled = await ChargeRepository.pay(db, OWNER, once.charges[0]!.id);

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
    const created = await BillingRepository.create(db, OWNER2, 'due-today', {
      type: BillingType.Indefinite,
      frequency: BillingFrequency.Monthly,
      direction: Direction.Payable,
      description: 'Academia',
      totalCents: 9_900,
      startDate: today,
      timezone: 'UTC'
    });

    equal(created.charges.length, 1, 'the first occurrence is a real charge, not a preview');
    equal(created.charges[0]!.dueDate, today);

    const next = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const patched = await BillingRepository.patch(db, OWNER2, created.id, { startDate: next });

    equal(patched.startDate, next);
    equal(patched.charges.length, 1, 'generated occurrences keep their due date');
    equal(patched.previews[0]?.occurrenceDate, next);
    await rejects(() => BillingRepository.patch(db, OWNER2, created.id, { startDate: '2020-01-01' }), /passado/);
  });
});
