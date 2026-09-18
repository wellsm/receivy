import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import {
  BillingFrequency,
  type BillingInput,
  BillingState,
  BillingRecurrence,
  Direction,
  ownerPays,
  PixKeyType,
  ProofState,
  SplitMode,
  SplitPartKind,
  chargeTotals
} from '@receivy/common';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { getBilling, listBillings } from '../../src/billings/services/detail';
import { ApiError } from '../../src/common/errors';
import { createInvite } from '../../src/invites/services/links';
import { ProofDeclarationForbiddenError } from '../../src/proofs/errors';
import { declarePayment, reviewProof } from '../../src/proofs/services/proof';
import type { ProofStorage } from '../../src/proofs/services/storage';
import { publishChargeLink } from '../../src/public/services/public-link';
import { contactLedger } from '../../src/timeline/services/ledger';
import { charges, cleanupUsers, contacts, createUser, db, monthCharges, paymentMethods } from '../fixtures/financial';

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const PAYEE = 'c2222222-2222-4222-8222-222222222222';
const SECRET = 'payable-spec-secret-with-enough-length-0123456789';

let payeeContactId: string;
/** A contact nobody uses the app for: the bill is the owner's, and only the name says who receives it. */
let soloContactId: string;
/** Keys of the receiving contact: a conta a pagar may only ever point at one of these. */
let payeeKeyId: string;
let payeeOtherKeyId: string;
/** A key of the owner's own wallet: out of scope for a conta a pagar. */
let ownKeyId: string;

function payable(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    recurrence: BillingRecurrence.Once,
    contactId: payeeContactId,
    description: 'Aluguel',
    totalCents: 150_000,
    startDate: '2026-11-05',
    timezone: 'America/Sao_Paulo',
    paymentMethodId: payeeKeyId,
    ...overrides
  };
}

/** The same bill with nobody to confirm it: a contact without an account, and no key to pay through. */
function solo(overrides: Partial<BillingInput> = {}): BillingInput {
  return payable({ contactId: soloContactId, paymentMethodId: undefined, ...overrides });
}

describe('contas a pagar on native PostgreSQL', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'payable-owner@example.com', name: 'Dona' });
    await createUser(db, { id: PAYEE, email: 'payable-payee@example.com', name: 'Credora' });

    payeeContactId = (
      await contacts.save(OWNER, { name: 'Credora', email: 'payable-payee@example.com', nickname: 'Imobiliária' })
    ).id;
    soloContactId = (await contacts.save(OWNER, { name: 'Netflix' })).id;
    payeeKeyId = (
      await paymentMethods.save(OWNER, {
        pixKeyType: PixKeyType.Email,
        pixKey: 'Imobiliaria@Example.com',
        label: 'Imobiliária',
        contactId: payeeContactId
      })
    ).id;
    payeeOtherKeyId = (
      await paymentMethods.save(OWNER, {
        pixKeyType: PixKeyType.Cpf,
        pixKey: '529.982.247-25',
        label: 'Nova',
        contactId: payeeContactId
      })
    ).id;
    ownKeyId = (await paymentMethods.save(OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'dona@example.com' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYEE]));

  it('creates a bill the owner pays alone: one owner-paid charge named after the contact, no wallet key', async () => {
    const created = await createBilling(db, OWNER, 'payable-alone', solo({ description: 'Netflix', totalCents: 3_990 }));

    equal(created.type, 'payable');
    equal(created.contact?.id, soloContactId);
    equal(created.contact?.name, 'Netflix');
    equal(created.pix, null);
    ok(!created.paymentMethodId);
    deepEqual(created.split, { mode: 'equal', parts: [{ kind: 'owner' }] });
    equal(created.charges.length, 1);

    const charge = created.charges[0]!;

    equal(charge.direction, 'payable');
    equal(ownerPays(charge), true);
    equal(charge.ownedByViewer, true);
    equal(charge.hasPix, false);
    equal(charge.counterpartName, 'Netflix');
    equal(charge.sharingState, 'closed');
    equal(charge.amount.amountCents, 3_990);

    const summary = (await listBillings(db, OWNER, { type: Direction.Payable })).billings.find(
      (row) => row.id === created.id
    );

    equal(summary?.type, 'payable');
    equal(summary?.contact?.name, 'Netflix');
    equal(summary?.participantCount, 0, 'the contact who receives is not a participant');
    ok(!(await listBillings(db, OWNER, { type: Direction.Receivable })).billings.some((row) => row.id === created.id));
  });

  it('ignores a split and refuses any key outside the receiving contact scope', async () => {
    const ignored = await createBilling(
      db,
      OWNER,
      'payable-split',
      solo({
        description: 'Divisão ignorada',
        split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: PAYEE, amountCents: 1 }] }
      })
    );

    deepEqual(ignored.split, { mode: 'equal', parts: [{ kind: 'owner' }] });

    await rejects(
      () =>
        createBilling(
          db,
          OWNER,
          'payable-wallet',
          solo({ description: 'Chave alheia', paymentMethodId: 'a1111111-1111-4111-8111-111111111111' })
        ),
      HttpNotFoundError
    );
    // The owner's own key is not the receiving contact's: a conta a pagar may only point inside their scope.
    await rejects(() => createBilling(db, OWNER, 'payable-own-key', payable({ paymentMethodId: ownKeyId })), HttpNotFoundError);
  });

  it('shows the payee the same charge as receivable, with settle powers only', async () => {
    // Due this month at the latest: the feed never lists charges past the end of the current month.
    const created = await createBilling(db, OWNER, 'payable-payee', payable({ startDate: '2026-09-05' }));
    const chargeId = created.charges[0]!.id;

    equal(created.contact?.id, payeeContactId);
    equal(created.contact?.userId, PAYEE);
    deepEqual(created.pix, { keyType: PixKeyType.Email, key: 'imobiliaria@example.com', label: 'Imobiliária' });
    equal(created.charges[0]!.counterpartName, 'Imobiliária');
    equal(created.charges[0]!.hasPix, true);

    const seenByPayee = await charges.get(PAYEE, chargeId);

    equal(seenByPayee.direction, 'receivable');
    equal(ownerPays(seenByPayee), true);
    equal(seenByPayee.ownedByViewer, false);
    equal(seenByPayee.counterpartName, 'Dona');
    equal(seenByPayee.sharingState, 'closed');

    // The billing itself stays owner-scoped.
    await rejects(() => getBilling(db, PAYEE, created.id), HttpNotFoundError);
    await rejects(() => patchBilling(db, PAYEE, created.id, { state: BillingState.Ended }), HttpNotFoundError);
    await rejects(() => charges.cancel(PAYEE, chargeId), HttpForbiddenError);
    await rejects(() => publishChargeLink(db, PAYEE, chargeId, SECRET), HttpForbiddenError);
    await rejects(() => publishChargeLink(db, OWNER, chargeId, SECRET), HttpForbiddenError);
    await rejects(() => createInvite(db, OWNER, created.id, SECRET, 'https://receivy.test'), ApiError);
    // The owner ends the conta as a whole; a single occurrence is never cancelled.
    await rejects(() => charges.cancel(OWNER, chargeId), HttpForbiddenError);

    const month = seenByPayee.dueDate.slice(0, 7);
    const payeeFeed = await monthCharges(db, PAYEE, month);
    const ownerFeed = await monthCharges(db, OWNER, month);

    equal(payeeFeed.find((item) => item.id === chargeId)?.type, Direction.Receivable);
    equal(ownerFeed.find((item) => item.id === chargeId)?.type, Direction.Payable);
    equal(ownerFeed.find((item) => item.id === chargeId)?.ownedByViewer, true);
    equal(chargeTotals(ownerFeed).payable.count >= 1, true);

    const ledger = await contactLedger(db, OWNER, payeeContactId);

    equal(ledger.payable.amountCents, 150_000);

    const settled = await charges.pay(PAYEE, chargeId);

    equal(settled.state, 'paid');
    equal(settled.direction, 'receivable');
  });

  it('tells whether a declared payment needs someone to confirm it', async () => {
    // Due this month at the latest, so the feed (capped at the month end) lists them.
    const due = { startDate: '2026-09-05' };
    const withPayee = await createBilling(db, OWNER, 'payable-confirm-active', payable({ ...due, description: 'Confirma' }));
    const placeholder = await contacts.save(OWNER, { name: 'Sem app', email: 'payable-placeholder@example.com' });
    const withPlaceholder = await createBilling(
      db,
      OWNER,
      'payable-confirm-pending',
      payable({ ...due, contactId: placeholder.id, description: 'Sem app', paymentMethodId: undefined })
    );
    const alone = await createBilling(db, OWNER, 'payable-confirm-alone', solo({ ...due, description: 'Só minha' }));

    equal((await charges.get(OWNER, withPayee.charges[0]!.id)).confirmationRequired, true);
    equal((await charges.get(OWNER, withPlaceholder.charges[0]!.id)).confirmationRequired, false);
    equal((await charges.get(OWNER, alone.charges[0]!.id)).confirmationRequired, false);
    equal((await charges.get(OWNER, alone.charges[0]!.id)).proofKind, null);

    const feed = await monthCharges(db, OWNER, withPayee.charges[0]!.dueDate.slice(0, 7));

    equal(feed.find((item) => item.id === withPayee.charges[0]!.id)?.confirmationRequired, true);
    equal(feed.find((item) => item.id === alone.charges[0]!.id)?.confirmationRequired, false);
  });

  it('lets the owner declare a bill only to a payee who can confirm, and the payee answer it', async () => {
    const due = { startDate: '2026-09-05' };
    const confirmable = await createBilling(db, OWNER, 'payable-declare-active', payable({ ...due, description: 'Declara' }));
    const alone = await createBilling(db, OWNER, 'payable-declare-alone', solo({ ...due, description: 'Sozinha' }));
    // A declaration never touches the bucket unless an upload slot was open.
    const storage = { delete: async () => undefined } as unknown as ProofStorage;
    const chargeId = confirmable.charges[0]!.id;

    await rejects(() => declarePayment(db, storage, alone.charges[0]!.id, { userId: OWNER }), ProofDeclarationForbiddenError);
    await rejects(() => declarePayment(db, storage, chargeId, { userId: PAYEE }), ProofDeclarationForbiddenError);
    await rejects(() => charges.pay(OWNER, chargeId), ProofDeclarationForbiddenError);

    equal((await charges.pay(OWNER, alone.charges[0]!.id)).state, 'paid', 'a bill nobody confirms settles at once');

    await declarePayment(db, storage, chargeId, { userId: OWNER });

    equal((await charges.get(PAYEE, chargeId)).proofKind, 'declaration');
    equal((await reviewProof(db, chargeId, PAYEE, { decision: ProofState.Accepted })).state, 'paid');
  });

  it('lets the owner settle their own bill and repoint it at another key of the contact', async () => {
    const created = await createBilling(
      db,
      OWNER,
      'payable-self-settle',
      payable({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2099-01-05', description: 'Assinatura' })
    );

    const patched = await patchBilling(db, OWNER, created.id, { paymentMethodId: payeeOtherKeyId });

    deepEqual(patched.pix, { keyType: PixKeyType.Cpf, key: '52998224725', label: 'Nova' });

    // A key is removed where it lives, under the contact: the billing follows whatever is left there.
    await paymentMethods.archive(OWNER, patched.paymentMethodId!);

    equal((await getBilling(db, OWNER, created.id)).pix, null);

    const repointed = await patchBilling(db, OWNER, created.id, { paymentMethodId: payeeKeyId });

    deepEqual(repointed.pix, { keyType: PixKeyType.Email, key: 'imobiliaria@example.com', label: 'Imobiliária' });

    await rejects(
      () => patchBilling(db, OWNER, created.id, { paymentMethodId: 'a1111111-1111-4111-8111-111111111111' }),
      HttpNotFoundError
    );
    await rejects(() => patchBilling(db, OWNER, created.id, { paymentMethodId: ownKeyId }), HttpNotFoundError);

    const once = await createBilling(db, OWNER, 'payable-self-once', solo({ description: 'Luz', totalCents: 12_000 }));
    const settled = await charges.pay(OWNER, once.charges[0]!.id);

    equal(settled.state, 'paid');
    equal(settled.direction, 'payable');
    equal(settled.ownedByViewer, true);
  });
});

describe('assinatura due date on native PostgreSQL', () => {
  const OWNER2 = 'c3333333-3333-4333-8333-333333333333';

  let gymContactId: string;

  before(async () => {
    await createUser(db, { id: OWNER2, email: 'due-owner@example.com', name: 'Dona' });

    gymContactId = (await contacts.save(OWNER2, { name: 'Academia' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER2]));

  it('materializes an assinatura due today at creation and moves the next due date on patch', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await createBilling(db, OWNER2, 'due-today', {
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      contactId: gymContactId,
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
