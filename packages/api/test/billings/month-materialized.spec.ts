import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import {
  BillingFrequency,
  type BillingInput,
  BillingState,
  BillingRecurrence,
  Direction,
  EditScope,
  PendingChargesAction,
  PixKeyType,
  SplitMode,
  SplitPartKind,
  type SplitParty,
  ProofKind
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
let anaContactId: string;
let brunoId: string;
let brunoContactId: string;
let carlaId: string;
let carlaContactId: string;

function recurring(key: string, startDate: string, userIds: string[], overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    recurrence: BillingRecurrence.Indefinite,
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
    select: {
      id: true,
      due_date: true,
      state: true,
      amount_cents: true,
      creditor_id: true,
      debtor_id: true,
      payment_snapshot: true
    },
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

    const ana = await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'month-ana@example.com' });

    anaId = ana.userId;
    anaContactId = ana.id;

    const bruno = await ContactRepository.save(db, OWNER, { name: 'Bruno', email: 'month-bruno@example.com' });

    brunoId = bruno.userId;
    brunoContactId = bruno.id;

    const carla = await ContactRepository.save(db, OWNER, { name: 'Carla', email: 'month-carla@example.com' });

    carlaId = carla.userId;
    carlaContactId = carla.id;
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
      { ...recurring('Curso', '2026-03-05', [anaId]), recurrence: BillingRecurrence.Until, endDate: '2026-05-05' },
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
      { ...recurring('Curso', '2026-03-20', [anaId]), recurrence: BillingRecurrence.Until, endDate: '2026-05-20' },
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
    const [anaCharge] = (await chargeRows(billing.id)).filter((row) => row.debtor_id === anaId);

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
    const ana = rows.find((row) => row.debtor_id === anaId);
    const bruno = rows.find((row) => row.debtor_id === brunoId);
    const carla = rows.find((row) => row.debtor_id === carlaId);

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

    await db.proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: row!.id },
        state: StoredProofState.Pending,
        kind: ProofKind.File,
        actor_hash: 'month-materialized-spec',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });
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

    const brunoRows = (await chargeRows(back.id)).filter((row) => row.debtor_id === brunoId);

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
      { ...recurring('Curso', '2026-03-20', [anaId]), recurrence: BillingRecurrence.Until, endDate: '2026-04-20' },
      date('2026-03-05')
    );

    await rejects(
      () => BillingRepository.patch(db, OWNER, course.id, { applyTo: EditScope.CurrentMonth }, date('2026-03-06')),
      EditScopeNotRecurringError
    );
  });

  it('never cancels a paused recorrente on Pausar, even a charge an early reminder already put in next month', async () => {
    const earlyReminder = { reminders: [{ offsetDays: -5, enabled: true }] };

    // materializationHorizon('2026-03-29', [-5]) = max(endOfMonth = '2026-03-31', '2026-03-29' + 5 = '2026-04-03')
    // = '2026-04-03': the April 3 occurrence already exists at creation, one day before the reminder
    // itself (due date - 5 = '2026-03-29') would have forced the daily cron to create it anyway.
    const absent = await BillingRepository.create(
      db,
      OWNER,
      'month-pause-early-absent',
      recurring('Assinatura', '2026-04-03', [anaId], earlyReminder),
      date('2026-03-29')
    );

    deepEqual(
      absent.charges.map((charge) => charge.dueDate),
      ['2026-04-03']
    );

    await BillingRepository.patch(db, OWNER, absent.id, { state: BillingState.Paused }, date('2026-03-29'));
    deepEqual(
      (await chargeRows(absent.id)).map((row) => row.state),
      ['pending']
    );

    const keptExplicitly = await BillingRepository.create(
      db,
      OWNER,
      'month-pause-early-keep',
      recurring('Assinatura', '2026-04-03', [anaId], earlyReminder),
      date('2026-03-29')
    );

    await BillingRepository.patch(
      db,
      OWNER,
      keptExplicitly.id,
      { state: BillingState.Paused, pendingCharges: PendingChargesAction.Keep },
      date('2026-03-29')
    );
    deepEqual(
      (await chargeRows(keptExplicitly.id)).map((row) => row.state),
      ['pending']
    );
  });

  it('CurrentMonth leaves due_date and the Pix snapshot alone when the patch does not reschedule or touch Pix', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-current-untouched',
      recurring('Fatura', '2026-03-20', [anaId], { paymentMethodId: undefined }),
      date('2026-03-05')
    );
    const [before] = await chargeRows(billing.id);

    ok(before);
    equal(before.payment_snapshot?.value, '52998224725', 'picked up the only default payment method at creation');

    const alternate = await PaymentMethodRepository.save(db, OWNER, {
      pixKeyType: PixKeyType.Email,
      pixKey: 'alt@example.com',
      label: 'Alternativo'
    });

    await PaymentMethodRepository.makeDefault(db, OWNER, alternate.id);

    await BillingRepository.patch(db, OWNER, billing.id, { totalCents: 12_000, applyTo: EditScope.CurrentMonth }, date('2026-03-06'));

    const [after] = await chargeRows(billing.id);

    equal(after?.id, before.id, 'same charge, not cancelled and recreated');
    equal(after?.due_date, '2026-03-20', 'amount-only edit does not reschedule');
    equal(after?.amount_cents, 12_000);
    equal(
      after?.payment_snapshot?.value,
      before.payment_snapshot?.value,
      'an unrelated default-payment-method change must not rotate an already shared key'
    );

    await PaymentMethodRepository.makeDefault(db, OWNER, pixId);
  });

  it('applyTo on a paused billing creates no charge for a newly added person', async () => {
    const paused = await BillingRepository.create(
      db,
      OWNER,
      'month-paused-split',
      recurring('Pausada', '2026-03-20', [anaId]),
      date('2026-03-05')
    );

    await BillingRepository.patch(db, OWNER, paused.id, { state: BillingState.Paused }, date('2026-03-06'));

    const withCarla = {
      mode: SplitMode.Equal,
      parts: [anaId, carlaId].map((userId): SplitParty => ({ kind: SplitPartKind.User, userId }))
    } satisfies BillingInput['split'];

    await BillingRepository.patch(db, OWNER, paused.id, { split: withCarla, applyTo: EditScope.CurrentMonth }, date('2026-03-07'));

    const rows = await chargeRows(paused.id);

    ok(!rows.some((row) => row.debtor_id === carlaId), 'a paused billing never materializes a new occurrence');
  });

  it('CurrentMonth updating an existing charge does not fail because another participant was archived later', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-current-archived',
      recurring('Duo', '2026-03-20', [anaId, brunoId]),
      date('2026-03-05')
    );

    await ContactRepository.archive(db, OWNER, brunoContactId);

    // totalCents-only: neither Ana nor Bruno enters this month, so neither needs revalidation.
    await BillingRepository.patch(db, OWNER, billing.id, { totalCents: 12_000, applyTo: EditScope.CurrentMonth }, date('2026-03-06'));

    const ana = (await chargeRows(billing.id)).find((row) => row.debtor_id === anaId);

    equal(ana?.amount_cents, 6_000);
  });

  it('moves a conta a pagar to another contact for CurrentMonth, cancelling the charge of the old one', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'month-payable-move-contact',
      {
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        contactId: anaContactId,
        description: 'Aluguel',
        totalCents: 10_000,
        startDate: '2026-03-20',
        timezone: TZ,
        pix: { keyType: PixKeyType.Email, key: 'month-landlord@example.com', label: 'Imobiliária' }
      },
      date('2026-03-05')
    );
    const [anaCharge] = await chargeRows(billing.id);

    ok(anaCharge);
    equal(anaCharge.creditor_id, anaId, 'the contact receives: she sits on the creditor side');
    equal(
      anaCharge.payment_snapshot?.value,
      'month-landlord@example.com',
      'the typed key is filed under the contact and travels to the charge'
    );

    const moved = await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      { contactId: carlaContactId, applyTo: EditScope.CurrentMonth },
      date('2026-03-06')
    );

    const rows = await chargeRows(billing.id);
    const cancelled = rows.find((row) => row.id === anaCharge.id);
    const charged = rows.find((row) => row.creditor_id === carlaId);

    equal(cancelled?.state, 'cancelled');
    deepEqual((await EventRepository.list(db, anaCharge.id, 'charge.cancelled'))[0]?.payload, { reason: 'billing_edited' });

    equal(moved.type, Direction.Payable);
    equal(moved.contact?.id, carlaContactId);
    // A key belongs to the contact it was filed under: whoever receives now has none, so the bill points at nothing.
    equal(moved.pix, null);
    ok(!moved.paymentMethodId);
    deepEqual(moved.split, { mode: 'equal', parts: [{ kind: 'owner' }] });

    ok(charged, 'the month is charged to whoever receives now');
    equal(charged?.state, 'pending');
    equal(charged?.due_date, '2026-03-20');
    equal(charged?.amount_cents, 10_000);
    equal(charged?.payment_snapshot ?? null, null);
    equal(rows.length, 2);
  });
});
