import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  BillingFrequency,
  type BillingInput,
  BillingState,
  BillingType,
  PendingChargesAction,
  PixKeyType,
  SplitMode,
  SplitPartKind,
  type SplitParty
} from '@receivy/common';
import { PendingChargesWithoutStateError } from '../../src/billings/errors';
import { BillingRepository } from '../../src/billings/repositories/billing';
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

    // Task 6 uses brunoId/carlaId; this keeps noUnusedLocals quiet until then.
    void brunoId;
    void carlaId;
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
});
