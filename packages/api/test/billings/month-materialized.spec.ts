import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  BillingFrequency,
  type BillingInput,
  BillingState,
  BillingType,
  EditScope,
  PendingChargesAction,
  PixKeyType,
  SplitMode,
  SplitPartKind,
  type SplitParty
} from '@receivy/common';
import { EditScopeNotRecurringError, PendingChargesWithoutStateError } from '../../src/billings/errors';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { StoredProofState } from '../../src/charges/schemas/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = 'b6666666-6666-4666-8666-666666666666';
const TZ = 'America/Sao_Paulo';
const date = (value: string) => new Date(`${value}T12:00:00Z`);
const { context, sent } = fakeNotice();

let pixId: string;
let anaId: string;
let brunoId: string;
let carlaId: string;

function recurring(key: string, startDate: string, userIds: string[], overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Indefinite,
    frequency: BillingFrequency.Monthly,
    description: key,
    totalCents: 10_000,
    startDate,
    timezone: TZ,
    paymentMethodId: pixId,
    split: { mode: SplitMode.Equal, parts: userIds.map((userId): SplitParty => ({ kind: SplitPartKind.User, userId })) },
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, due_date: true, state: true, amount_cents: true, debtor_user_id: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

describe('month materialized: pending charges and current month edits', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'month-owner@example.com', name: 'Dona' });

    anaId = (await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'month-ana@example.com' })).userId;
    brunoId = (await ContactRepository.save(db, OWNER, { name: 'Bruno', email: 'month-bruno@example.com' })).userId;
    carlaId = (await ContactRepository.save(db, OWNER, { name: 'Carla', email: 'month-carla@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER]));

  it('creates the whole month of a recorrente at creation and leaves it to the reminder', async () => {
    sent.reset();

    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-create',
      recurring('Aluguel', '2026-03-20', [anaId]),
      date('2026-03-05'),
      undefined,
      context
    );

    deepEqual(
      billing.charges.map((charge) => charge.dueDate),
      ['2026-03-20']
    );
    equal(sent.emails.length, 0, 'the charge meets Ana through its reminder');
    equal(billing.nextMaterialization, '2026-04-01');
  });

  it('announces only the installment due today', async () => {
    sent.reset();

    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-installments',
      { ...recurring('Curso', '2026-03-05', [anaId]), type: BillingType.Until, endDate: '2026-05-05' },
      date('2026-03-05'),
      undefined,
      context
    );

    equal(billing.charges.length, 3);
    equal(sent.emails.length, 1);
  });

  it('keeps this month on Keep and cancels every pending charge on Cancel', async () => {
    const kept = await BillingRepository.create(
      db,
      OWNER,
      'month-pause-keep',
      recurring('Mantida', '2026-03-20', [anaId]),
      date('2026-03-05')
    );

    await BillingRepository.patch(
      db,
      OWNER,
      kept.id,
      { state: BillingState.Paused, pendingCharges: PendingChargesAction.Keep },
      date('2026-03-06')
    );
    deepEqual(
      (await chargeRows(kept.id)).map((row) => row.state),
      ['pending']
    );

    const dropped = await BillingRepository.create(
      db,
      OWNER,
      'month-pause-cancel',
      recurring('Cancelada', '2026-03-20', [anaId]),
      date('2026-03-05')
    );

    await BillingRepository.patch(
      db,
      OWNER,
      dropped.id,
      { state: BillingState.Paused, pendingCharges: PendingChargesAction.Cancel },
      date('2026-03-06')
    );

    const [row] = await chargeRows(dropped.id);

    ok(row);
    equal(row.state, 'cancelled');
    deepEqual((await EventRepository.list(db, row.id, 'charge.cancelled'))[0]?.payload, { reason: 'billing_paused' });

    const course = await BillingRepository.create(
      db,
      OWNER,
      'month-end-keep',
      { ...recurring('Curso', '2026-03-20', [anaId]), type: BillingType.Until, endDate: '2026-05-20' },
      date('2026-03-05')
    );

    await BillingRepository.patch(
      db,
      OWNER,
      course.id,
      { state: BillingState.Ended, pendingCharges: PendingChargesAction.Keep },
      date('2026-03-06')
    );
    deepEqual(
      (await chargeRows(course.id)).map((charge) => [charge.due_date, charge.state]),
      [
        ['2026-03-20', 'pending'],
        ['2026-04-20', 'cancelled'],
        ['2026-05-20', 'cancelled']
      ]
    );

    await rejects(
      () => BillingRepository.patch(db, OWNER, kept.id, { pendingCharges: PendingChargesAction.Cancel }, date('2026-03-06')),
      PendingChargesWithoutStateError
    );
  });

  it('rewrites the not yet due charges of this month on CurrentMonth', async () => {
    sent.reset();

    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-edit',
      recurring('Casa', '2026-03-20', [anaId, brunoId]),
      date('2026-03-05')
    );
    const [anaCharge] = (await chargeRows(billing.id)).filter((row) => row.debtor_user_id === anaId);

    ok(anaCharge);

    await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        totalCents: 12_000,
        split: { mode: SplitMode.Equal, parts: [anaId, carlaId].map((userId): SplitParty => ({ kind: SplitPartKind.User, userId })) },
        applyTo: EditScope.CurrentMonth
      },
      date('2026-03-06'),
      undefined,
      context
    );

    const rows = await chargeRows(billing.id);
    const ana = rows.find((row) => row.debtor_user_id === anaId);
    const bruno = rows.find((row) => row.debtor_user_id === brunoId);
    const carla = rows.find((row) => row.debtor_user_id === carlaId);

    equal(ana?.id, anaCharge.id, 'the charge keeps its id and public link');
    equal(ana?.amount_cents, 6_000);
    equal(bruno?.state, 'cancelled');
    deepEqual((await EventRepository.list(db, bruno!.id, 'charge.cancelled'))[0]?.payload, { reason: 'billing_edited' });
    equal(carla?.state, 'pending');
    equal(carla?.amount_cents, 6_000);
    equal((await EventRepository.list(db, anaCharge.id, 'charge.edited')).length, 1);
    equal(sent.emails.length, 0, 'Carla meets her charge through the reminder');
  });

  it('leaves charges due today or with a proof under review, and NextMonth touches nothing', async () => {
    const today = await BillingRepository.create(db, OWNER, 'month-today', recurring('Hoje', '2026-03-05', [anaId]), date('2026-03-05'));

    await BillingRepository.patch(db, OWNER, today.id, { totalCents: 5_000, applyTo: EditScope.CurrentMonth }, date('2026-03-05'));
    equal((await chargeRows(today.id))[0]?.amount_cents, 10_000);

    const reviewed = await BillingRepository.create(
      db,
      OWNER,
      'month-review',
      recurring('Revisão', '2026-03-20', [anaId]),
      date('2026-03-05')
    );
    const [row] = await chargeRows(reviewed.id);

    await db.charges.updateOne({ where: { id: row!.id }, data: { proof_state: StoredProofState.Pending } });
    await BillingRepository.patch(db, OWNER, reviewed.id, { totalCents: 5_000, applyTo: EditScope.CurrentMonth }, date('2026-03-06'));
    equal((await chargeRows(reviewed.id))[0]?.amount_cents, 10_000);

    const later = await BillingRepository.create(db, OWNER, 'month-next', recurring('Depois', '2026-03-20', [anaId]), date('2026-03-05'));

    await BillingRepository.patch(db, OWNER, later.id, { totalCents: 5_000, applyTo: EditScope.NextMonth }, date('2026-03-06'));
    equal((await chargeRows(later.id))[0]?.amount_cents, 10_000);

    const reminded = await BillingRepository.create(
      db,
      OWNER,
      'month-reminders',
      recurring('Lembrete', '2026-03-20', [anaId]),
      date('2026-03-05')
    );
    const [remindedCharge] = await chargeRows(reminded.id);

    await BillingRepository.patch(
      db,
      OWNER,
      reminded.id,
      { reminders: [{ offsetDays: -1, enabled: true }], applyTo: EditScope.CurrentMonth },
      date('2026-03-06')
    );
    equal((await chargeRows(reminded.id))[0]?.amount_cents, 10_000);
    equal((await EventRepository.list(db, remindedCharge!.id, 'charge.edited')).length, 0);
  });

  it('moves the due day inside the month and skips a person whose cancelled charge holds the date', async () => {
    const moved = await BillingRepository.create(db, OWNER, 'month-move', recurring('Mudou', '2026-03-20', [anaId]), date('2026-03-05'));
    const [before] = await chargeRows(moved.id);

    await BillingRepository.patch(db, OWNER, moved.id, { startDate: '2026-03-25', applyTo: EditScope.CurrentMonth }, date('2026-03-06'));

    const after = await chargeRows(moved.id);

    equal(after.length, 1, 'the month never gets a second charge');
    equal(after[0]?.id, before!.id);
    equal(after[0]?.due_date, '2026-03-25');

    const back = await BillingRepository.create(
      db,
      OWNER,
      'month-back',
      recurring('Volta', '2026-03-20', [anaId, brunoId]),
      date('2026-03-05')
    );
    const onlyAna = { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } satisfies BillingInput['split'];
    const both = {
      mode: SplitMode.Equal,
      parts: [anaId, brunoId].map((userId): SplitParty => ({ kind: SplitPartKind.User, userId }))
    } satisfies BillingInput['split'];

    await BillingRepository.patch(db, OWNER, back.id, { split: onlyAna, applyTo: EditScope.CurrentMonth }, date('2026-03-06'));
    await BillingRepository.patch(db, OWNER, back.id, { split: both, applyTo: EditScope.CurrentMonth }, date('2026-03-07'));

    const brunoRows = (await chargeRows(back.id)).filter((row) => row.debtor_user_id === brunoId);

    deepEqual(
      brunoRows.map((row) => row.state),
      ['cancelled']
    );
  });

  it('refuses applyTo on a finite billing', async () => {
    const course = await BillingRepository.create(
      db,
      OWNER,
      'month-finite-scope',
      { ...recurring('Curso', '2026-03-20', [anaId]), type: BillingType.Until, endDate: '2026-04-20' },
      date('2026-03-05')
    );

    await rejects(
      () => BillingRepository.patch(db, OWNER, course.id, { applyTo: EditScope.CurrentMonth }, date('2026-03-06')),
      EditScopeNotRecurringError
    );
  });
});
