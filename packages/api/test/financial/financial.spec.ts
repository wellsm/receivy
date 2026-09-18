import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpBadRequestError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { BillingFrequency, BillingRecurrence, chargeTotals, Direction, PaymentProvider, PixKeyType, SplitMode, SplitPartKind, shiftMonth } from '@receivy/common';
import { createBilling } from '../../src/billings/services/billing';
import { getBilling } from '../../src/billings/services/detail';
import { ApiError } from '../../src/common/errors';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { publicChargeByToken, publishChargeLink, revokeChargeLink } from '../../src/public/services/public-link';
import { contactLedger } from '../../src/timeline/services/ledger';
import { charges, cleanupUsers, contacts, createUser, db, monthCharges, paymentMethods } from '../fixtures/financial';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const LEDGER_OVERFLOW_OWNER = '55555555-5555-4555-8555-555555555555';
const LEDGER_NEGATIVE_VIEWER = '66666666-6666-4666-8666-666666666666';
const LEDGER_NEGATIVE_COUNTERPART = '77777777-7777-4777-8777-777777777777';
const MONTH_OWNER = '88888888-8888-4888-8888-888888888888';
const SECRET = 'native-ez4-test-public-link-secret';
const OVERFLOW_MESSAGE = 'O total financeiro deve estar entre -9007199254740991 e 9007199254740991 centavos.';

describe('financial repositories on PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests', 'financial integration tests must use the dedicated test database');

    await createUser(db, { id: OWNER, email: 'owner@example.com', name: 'Ana Silva' });
    await createUser(db, { id: STRANGER, email: 'stranger@example.com', name: 'Terceira Pessoa' });
  });

  after(async () =>
    cleanupUsers(db, [
      OWNER,
      STRANGER,
      LEDGER_OVERFLOW_OWNER,
      LEDGER_NEGATIVE_VIEWER,
      LEDGER_NEGATIVE_COUNTERPART,
      MONTH_OWNER
    ])
  );

  it('keeps payment methods owner-scoped and returns post-update default state', async () => {
    const first = await paymentMethods.save(OWNER, {
      provider: PaymentProvider.Pix,
      kind: PixKeyType.Cpf,
      value: '529.982.247-25',
      label: 'Principal'
    });

    equal(first.isDefault, true);

    const edited = await paymentMethods.save(
      OWNER,
      { provider: PaymentProvider.Pix, kind: PixKeyType.Random, value: '123e4567-e89b-12d3-a456-426614174000', label: 'Editada' },
      first.id
    );

    equal(edited.value, '123e4567-e89b-12d3-a456-426614174000');

    const second = await paymentMethods.save(OWNER, {
      provider: PaymentProvider.Pix,
      kind: PixKeyType.Phone,
      value: '+55 (11) 99876-5432',
      label: 'Telefone'
    });
    const madeDefault = await paymentMethods.makeDefault(OWNER, second.id);

    equal(madeDefault.isDefault, true);
    deepEqual(
      (await PaymentMethodRepository.list(db, OWNER)).filter((method) => method.isDefault).map((method) => method.id),
      [second.id]
    );
    deepEqual(await PaymentMethodRepository.list(db, STRANGER), []);

    await paymentMethods.archive(OWNER, second.id);

    deepEqual(
      (await PaymentMethodRepository.list(db, OWNER)).filter((method) => method.isDefault).map((method) => method.id),
      [first.id]
    );
  });

  it('binds idempotency to payload, reads the recipient live and keeps the Pix snapshot', async () => {
    const person = await contacts.save(OWNER, { name: 'Bruno Original', email: 'bruno@example.com' });
    const debtor = person.userId;
    const pix = await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '111.444.777-35', label: 'Despesa' });
    const input = {
      recurrence: BillingRecurrence.Once as const,
      totalCents: 9_000,
      startDate: '2026-10-31',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed as const, parts: [{ kind: SplitPartKind.User as const, userId: person.userId, amountCents: 6_001 }] },
      paymentMethodId: pix.id
    };
    const created = await createBilling(db, OWNER, 'billing-idempotency', input);
    const replay = await createBilling(db, OWNER, 'billing-idempotency', input);

    equal(replay.id, created.id);
    equal((await getBilling(db, OWNER, created.id)).id, created.id);

    await rejects(() => getBilling(db, STRANGER, created.id), HttpNotFoundError);

    deepEqual(
      created.charges.map((charge) => charge.amount.amountCents),
      [6_001]
    );

    await rejects(() => createBilling(db, OWNER, 'billing-idempotency', { ...input, totalCents: 9_001 }), ApiError);

    // A pending contact cannot be moved onto an e-mail another account holds, so charge access never transfers.
    await rejects(
      () => contacts.save(OWNER, { name: 'Contato Editado', email: 'stranger@example.com' }, person.id),
      ApiError,
      'changing a contact link must not transfer historical charge access'
    );
    await contacts.save(OWNER, { name: 'Contato Editado', email: 'bruno@example.com' }, person.id);
    await paymentMethods.save(
      OWNER,
      { provider: PaymentProvider.Pix, kind: PixKeyType.Random, value: '9f1c5dd7-95d6-4a8a-a859-2d941eb3d28a', label: 'Nova' },
      pix.id
    );

    const snapshot = await charges.get(OWNER, created.charges[0]!.id);

    deepEqual(snapshot.recipient, { userId: debtor, name: 'Contato Editado', email: 'bruno@example.com', avatar: null });
    equal(snapshot.payment?.value, '11144477735');

    await rejects(() => charges.get(STRANGER, snapshot.id), HttpForbiddenError);
    await rejects(() => contactLedger(db, STRANGER, person.id), HttpNotFoundError);

    // The pending account created for the contact is the debtor: it sees the charge before any login.
    equal((await charges.get(debtor, snapshot.id)).direction, 'payable');

    await rejects(() => charges.cancel(debtor, snapshot.id), HttpForbiddenError);
    await rejects(() => charges.pay(debtor, snapshot.id), HttpForbiddenError);
    await rejects(() => charges.reopen(debtor, snapshot.id), HttpForbiddenError);
    await rejects(() => charges.reopen(OWNER, snapshot.id), ApiError, 'only a paid charge can be reopened');
    await rejects(() => charges.get(STRANGER, snapshot.id), HttpForbiddenError);
    await rejects(() => createBilling(db, debtor, 'foreign-person', input), HttpNotFoundError);

    const ownPerson = await contacts.save(debtor, { name: 'Contato do devedor', email: 'debtor-contact@example.com' });

    await rejects(
      () =>
        createBilling(db, debtor, 'foreign-pix', {
          ...input,
          split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: ownPerson.userId, amountCents: 6_001 }] }
        }),
      HttpNotFoundError
    );
    await contacts.archive(OWNER, person.id);
    await rejects(() => createBilling(db, OWNER, 'archived-person', input), HttpNotFoundError);
    await paymentMethods.archive(OWNER, pix.id);

    const active = await contacts.save(OWNER, { name: 'Contato ativo', email: 'active-contact@example.com' });

    await rejects(
      () =>
        createBilling(db, OWNER, 'archived-pix', {
          ...input,
          split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: active.userId, amountCents: 6_001 }] }
        }),
      HttpNotFoundError
    );
  });

  it('serializes integral payment and preserves terminal charge state with audit', async () => {
    const person = await contacts.save(OWNER, { name: 'Concorrente', email: 'concurrency@example.com' });
    const billing = await createBilling(db, OWNER, 'payment-concurrency', {
      recurrence: BillingRecurrence.Once,
      totalCents: 1_000,
      startDate: '2026-11-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 1_000 }] }
    });
    const chargeId = billing.charges[0]!.id;
    const outcomes = await Promise.allSettled([charges.pay(OWNER, chargeId), charges.pay(OWNER, chargeId)]);

    equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    equal(outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason instanceof ApiError).length, 1);

    const paid = await db.charges.findOne({ select: { state: true, paid_at: true }, where: { id: chargeId } });

    equal(paid?.state, 'paid');
    ok(paid?.paid_at);
    equal(await db.events.count({ where: { eventable_id: chargeId, type: 'charge.paid' } }), 1, 'the winner settles once');
    equal((await charges.get(OWNER, chargeId)).state, 'paid');

    await rejects(() => charges.cancel(OWNER, chargeId), ApiError);

    const cancellable = await createBilling(db, OWNER, 'charge-cancellation', {
      recurrence: BillingRecurrence.Once,
      totalCents: 750,
      startDate: '2026-11-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 750 }] }
    });
    const cancelled = await charges.cancel(OWNER, cancellable.charges[0]!.id);

    equal(cancelled.state, 'cancelled');
    equal((await charges.cancel(OWNER, cancelled.id)).state, 'cancelled');

    await rejects(() => charges.pay(OWNER, cancelled.id), ApiError);

    const events = await db.events.findMany({ select: { type: true }, where: { eventable_id: chargeId } });

    ok(events.records.some((event) => event.type === 'charge.created'));
    ok(events.records.some((event) => event.type === 'charge.paid'));
    equal(await db.events.count({ where: { eventable_id: chargeId, type: 'charge.created' } }), 1);
  });

  it('returns one persisted result for simultaneous identical billing idempotency keys', async () => {
    const person = await contacts.save(OWNER, { name: 'Idempotent race', email: 'idempotent-race@example.com' });
    const input = {
      recurrence: BillingRecurrence.Until as const,
      frequency: BillingFrequency.Monthly as const,
      totalCents: 101,
      startDate: '2026-11-01',
      endDate: '2026-12-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed as const, parts: [{ kind: SplitPartKind.User as const, userId: person.userId, amountCents: 101 }] }
    };
    const [first, second] = await Promise.all([
      createBilling(db, OWNER, 'same-key-race', input),
      createBilling(db, OWNER, 'same-key-race', input)
    ]);

    deepEqual(first, second);
    equal(await db.billings.count({ where: { id: first.id } }), 1);
    equal(await db.allocations.count({ where: { billing_id: first.id } }), 2);
    equal(await db.charges.count({ where: { billing_id: first.id } }), 2);

    for (const charge of first.charges) {
      equal(await db.events.count({ where: { eventable_id: charge.id, type: 'charge.created' } }), 1);
    }
  });

  it('expires, rotates and revokes public capabilities without leaking private fields', async () => {
    const person = await contacts.save(OWNER, { name: 'Público', email: 'public@example.com' });
    const billing = await createBilling(db, OWNER, 'public-capability', {
      recurrence: BillingRecurrence.Once,
      totalCents: 2_500,
      startDate: '2026-12-10',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 2_500 }] }
    });
    const chargeId = billing.charges[0]!.id;
    const first = await publishChargeLink(db, OWNER, chargeId, SECRET, false, 1_000);

    deepEqual(
      Object.keys(await publicChargeByToken(db, first.token, SECRET, 1_001)).sort(),
      ['amount', 'creditorFirstName', 'description', 'dueDate', 'payment', 'paymentLink', 'receiptUrl', 'state', 'uploadsEnabled'].sort()
    );

    const expiresAt = Math.floor(new Date(first.expiresAt).getTime() / 1000);

    await rejects(() => publicChargeByToken(db, first.token, SECRET, expiresAt), HttpNotFoundError);

    const rotated = await publishChargeLink(db, OWNER, chargeId, SECRET, true, 2_000);

    notEqual(rotated.token, first.token);

    await rejects(() => publicChargeByToken(db, first.token, SECRET, 2_001), HttpNotFoundError);
    await revokeChargeLink(db, OWNER, chargeId);
    await rejects(() => publicChargeByToken(db, rotated.token, SECRET, 2_001), HttpNotFoundError);
  });

  it('lists the month from the owner side and answers a contact ledger', async () => {
    const person = await contacts.save(OWNER, { name: 'Ledger', email: 'ledger@example.com' });
    const billing = await createBilling(db, OWNER, 'timeline-ledger', {
      recurrence: BillingRecurrence.Until,
      frequency: BillingFrequency.Monthly,
      totalCents: 6_001,
      // Both installments fall no later than this month: the feed stops at the end of the current month.
      startDate: '2026-08-31',
      endDate: '2026-09-30',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 6_001 }] }
    });

    await charges.pay(OWNER, billing.charges[0]!.id);

    const feed = await monthCharges(db, OWNER, '2026-09');
    const second = feed.find((item) => item.id === billing.charges[1]!.id);

    equal(second?.type, Direction.Receivable);
    equal(second?.billing.recurrence, BillingRecurrence.Until);
    equal(second?.ownedByViewer, true);
    equal(chargeTotals(feed).receivable.pending.amountCents >= 3_000, true);

    const ledger = await contactLedger(db, OWNER, person.id);

    // Each occurrence snapshots the full split amount; only the second (still pending) counts here.
    equal(ledger.receivable.amountCents, 6_001);
    equal(ledger.charges.length, 2);

    const emptyPage = await contactLedger(db, OWNER, person.id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');

    equal(emptyPage.charges.length, 0);
    equal(emptyPage.receivable.amountCents, 6_001, 'ledger totals must not change with its cursor');
  });

  it('moves a charge paid this month from the open total to the settled one', async () => {
    const person = await contacts.save(OWNER, { name: 'Settled', email: 'settled@example.com' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const billing = await createBilling(db, OWNER, 'timeline-settled', {
      recurrence: BillingRecurrence.Once,
      totalCents: 4_321,
      startDate: today,
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 4_321 }] }
    });
    const before = chargeTotals(await monthCharges(db, OWNER, today.slice(0, 7)));

    await charges.pay(OWNER, billing.charges[0]!.id);

    const after = chargeTotals(await monthCharges(db, OWNER, today.slice(0, 7)));

    equal(after.receivable.paid.amountCents - before.receivable.paid.amountCents, 4_321);
    equal(before.receivable.pending.amountCents - after.receivable.pending.amountCents, 4_321);
    equal(after.payable.paid.amountCents, before.payable.paid.amountCents);
  });

  it('serves one selected month, folding an earlier pending charge into the current month as overdue', async () => {
    await createUser(db, { id: MONTH_OWNER, email: 'month-owner@example.com', name: 'Mês' });

    const person = await contacts.save(MONTH_OWNER, { name: 'Mês contato', email: 'month-contact@example.com' });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const thisMonth = today.slice(0, 7);
    const pastMonth = shiftMonth(thisMonth, -1);
    const nextMonth = shiftMonth(thisMonth, 1);

    const pastPaid = await createBilling(db, MONTH_OWNER, 'month-past-paid', {
      recurrence: BillingRecurrence.Once,
      totalCents: 1_100,
      startDate: `${pastMonth}-05`,
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 1_100 }] }
    });

    await charges.pay(MONTH_OWNER, pastPaid.charges[0]!.id);

    const pastOverdue = await createBilling(db, MONTH_OWNER, 'month-past-overdue', {
      recurrence: BillingRecurrence.Once,
      totalCents: 1_200,
      startDate: `${pastMonth}-06`,
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 1_200 }] }
    });

    const future = await createBilling(db, MONTH_OWNER, 'month-future', {
      recurrence: BillingRecurrence.Once,
      totalCents: 1_300,
      startDate: `${nextMonth}-07`,
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 1_300 }] }
    });

    // A past month: only its own charges, and its paid total.
    const pastPage = await monthCharges(db, MONTH_OWNER, pastMonth);

    deepEqual(new Set(pastPage.map((item) => item.id)), new Set([pastPaid.charges[0]!.id, pastOverdue.charges[0]!.id]));
    equal(chargeTotals(pastPage).receivable.paid.amountCents, 1_100);
    equal(chargeTotals(pastPage).receivable.pending.amountCents, 1_200);

    // The current month: the earlier pending charge carries over as overdue, the paid one does not.
    const currentPage = await monthCharges(db, MONTH_OWNER, thisMonth);
    const currentIds = currentPage.map((item) => item.id);

    ok(currentIds.includes(pastOverdue.charges[0]!.id));
    ok(!currentIds.includes(pastPaid.charges[0]!.id));
    ok(!currentIds.includes(future.charges[0]!.id));
    equal(chargeTotals(currentPage).receivable.paid.amountCents, 0, 'a paid charge due last month is not this month’s "realizado"');

    // A future month: reachable, and isolated from the others.
    const nextPage = await monthCharges(db, MONTH_OWNER, nextMonth);

    deepEqual(
      nextPage.map((item) => item.id),
      [future.charges[0]!.id]
    );

    await rejects(
      () => monthCharges(db, MONTH_OWNER, '2026-13'),
      (error) => {
        ok(error instanceof HttpBadRequestError);
        equal(error.status, 400);

        return true;
      }
    );
  });

  it('rejects a positive ledger balance outside safe integer cents', async () => {
    await createUser(db, { id: LEDGER_OVERFLOW_OWNER, email: 'ledger-overflow@example.com', name: 'Ledger Overflow' });

    const person = await contacts.save(LEDGER_OVERFLOW_OWNER, { name: 'Ledger debtor', email: 'ledger-debtor@example.com' });

    await createBilling(db, LEDGER_OVERFLOW_OWNER, 'ledger-overflow-max', {
      recurrence: BillingRecurrence.Once,
      totalCents: Number.MAX_SAFE_INTEGER,
      startDate: '2027-02-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: Number.MAX_SAFE_INTEGER }] }
    });
    await createBilling(db, LEDGER_OVERFLOW_OWNER, 'ledger-overflow-two', {
      recurrence: BillingRecurrence.Once,
      totalCents: 2,
      startDate: '2027-02-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: person.userId, amountCents: 2 }] }
    });

    await rejects(
      () => contactLedger(db, LEDGER_OVERFLOW_OWNER, person.id),
      (error) => {
        ok(error instanceof ApiError);
        equal(error.message, OVERFLOW_MESSAGE);

        return true;
      }
    );
  });

  it('rejects a negative ledger balance outside safe integer cents', async () => {
    await createUser(db, { id: LEDGER_NEGATIVE_VIEWER, email: 'negative-viewer@example.com', name: 'Negative Viewer' });
    await createUser(db, { id: LEDGER_NEGATIVE_COUNTERPART, email: 'negative-counterpart@example.com', name: 'Negative Counterpart' });

    const counterpart = await contacts.save(LEDGER_NEGATIVE_VIEWER, {
      name: 'Counterpart',
      email: 'negative-counterpart@example.com'
    });
    const viewer = await contacts.save(LEDGER_NEGATIVE_COUNTERPART, { name: 'Viewer', email: 'negative-viewer@example.com' });

    await createBilling(db, LEDGER_NEGATIVE_COUNTERPART, 'ledger-negative-max', {
      recurrence: BillingRecurrence.Once,
      totalCents: Number.MAX_SAFE_INTEGER,
      startDate: '2027-03-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: viewer.userId, amountCents: Number.MAX_SAFE_INTEGER }] }
    });
    await createBilling(db, LEDGER_NEGATIVE_COUNTERPART, 'ledger-negative-two', {
      recurrence: BillingRecurrence.Once,
      totalCents: 2,
      startDate: '2027-03-02',
      timezone: 'America/Sao_Paulo',
      split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: viewer.userId, amountCents: 2 }] }
    });

    await rejects(
      () => contactLedger(db, LEDGER_NEGATIVE_VIEWER, counterpart.id),
      (error) => {
        ok(error instanceof ApiError);
        equal(error.message, OVERFLOW_MESSAGE);

        return true;
      }
    );
  });
});
