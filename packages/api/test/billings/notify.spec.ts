import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import {
  BillingFrequency,
  type BillingInput,
  BillingRecurrence,
  ChargeState,
  EditScope,
  PaymentProvider,
  PixKeyType,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { createBilling, patchBilling, setParticipantNotify } from '../../src/billings/services/billing';
import { materializeNextOccurrence } from '../../src/billings/services/materialize';
import { ChargeClosedError, SilenceUnavailableError } from '../../src/charges/errors';
import { EventRepository } from '../../src/common/repositories/events';
import { acceptInvite } from '../../src/invites/services/invite';
import { createInvite } from '../../src/invites/services/links';
import { contactLedger } from '../../src/timeline/services/ledger';
import { charges, cleanupUsers, contacts, createUser, db, paymentMethods } from '../fixtures/financial';

const OWNER = 'd1111111-1111-4111-8111-111111111111';
const OTHER = 'd2222222-2222-4222-8222-222222222222';
const GUEST = 'd3333333-3333-4333-8333-333333333333';
const SECRET = 'silenced-spec-capability-secret';
const ORIGIN = 'http://localhost:3000';
const TZ = 'America/Sao_Paulo';
const date = (value: string) => new Date(`${value}T12:00:00Z`);
const tokenOf = (url: string) => url.slice(`${ORIGIN}/join/`.length);

let pixId: string;
let anaId: string;
let anaContactId: string;
let brunoId: string;
let carlaId: string;

/** A monthly recorrente starting in February, with Ana quiet and Bruno notified. */
function recurring(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    recurrence: BillingRecurrence.Indefinite,
    frequency: BillingFrequency.Monthly,
    description: key,
    totalCents: 10_000,
    startDate: '2026-02-15',
    timezone: TZ,
    paymentMethodId: pixId,
    split: {
      mode: SplitMode.Equal,
      parts: [
        { kind: SplitPartKind.User, userId: anaId, notify: false },
        { kind: SplitPartKind.User, userId: brunoId }
      ]
    },
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_id: true, due_date: true, state: true, notify: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

async function allocationFlags(billingId: string) {
  const { records } = await db.allocations.findMany({
    select: { user_id: true, notify: true },
    where: { billing_id: billingId, user_id: { not: OWNER } },
    order: { sort_order: Order.Asc }
  });

  return records.map((row) => [row.user_id, row.notify]);
}

/** The owner's own bill, owed to Ana: nothing here has notices to pause. */
function payableOnce(key: string): BillingInput {
  return {
    recurrence: BillingRecurrence.Once,
    description: key,
    totalCents: 5_000,
    startDate: '2026-03-10',
    timezone: TZ,
    contactId: anaContactId
  };
}

describe('sem avisos on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'silenced-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'silenced-other@example.com', name: 'Outra' });
    await createUser(db, { id: GUEST, email: 'silenced-guest@example.com', name: 'Gabi' });

    const ana = await contacts.save(OWNER, { name: 'Ana', email: 'silenced-ana@example.com' });

    anaId = ana.userId;
    anaContactId = ana.id;
    brunoId = (await contacts.save(OWNER, { name: 'Bruno', email: 'silenced-bruno@example.com' })).userId;
    carlaId = (await contacts.save(OWNER, { name: 'Carla', email: 'silenced-carla@example.com' })).userId;
    pixId = (await paymentMethods.save(OWNER, { provider: PaymentProvider.Pix, kind: PixKeyType.Cpf, value: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER, GUEST]));

  it('copies a quiet participant to the allocation and to every charge created for them', async () => {
    const created = await createBilling(
      db,
      OWNER,
      'silenced-create',
      {
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        description: 'Curso',
        totalCents: 6_000,
        startDate: '2026-03-10',
        endDate: '2026-04-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: {
          mode: SplitMode.Fixed,
          parts: [
            { kind: SplitPartKind.User, userId: anaId, notify: false, amountCents: 3_000 },
            { kind: SplitPartKind.User, userId: brunoId, amountCents: 3_000 }
          ]
        }
      },
      date('2026-03-01')
    );

    deepEqual(await allocationFlags(created.id), [
      [anaId, false],
      [brunoId, true]
    ]);
    deepEqual(
      created.allocations.map((allocation) => [allocation.kind, allocation.notify]),
      [
        ['user', false],
        ['user', true],
        ['owner', true]
      ]
    );

    const rows = await chargeRows(created.id);

    equal(rows.length, 4);
    ok(rows.filter((row) => row.debtor_id === anaId).every((row) => row.notify === false));
    ok(rows.filter((row) => row.debtor_id === brunoId).every((row) => row.notify !== false));

    const anaCharge = created.charges.find((charge) => charge.debtorId === anaId)!;

    equal(anaCharge.notify, false);
    equal(created.charges.find((charge) => charge.debtorId === brunoId)!.notify, true);
    equal((await charges.get(anaId, anaCharge.id)).notify, true, 'whoever owes sees no difference');

    const ledger = await contactLedger(db, OWNER, anaContactId);

    equal(ledger.charges.find((charge) => charge.id === anaCharge.id)?.notify, false);
  });

  it('copies the participant value to the charges of each new month', async () => {
    const billing = await createBilling(db, OWNER, 'silenced-monthly', recurring('Aluguel'), date('2026-01-01'));
    const done = await materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    equal(done.materialized, true);

    const rows = await chargeRows(billing.id);

    equal(rows.length, 2);
    equal(rows.find((row) => row.debtor_id === anaId)?.notify, false);
    equal(rows.find((row) => row.debtor_id === brunoId)?.notify === false, false);
  });

  it('keeps the value of whoever stays, applies the one sent and moves their pending charges', async () => {
    const billing = await createBilling(db, OWNER, 'silenced-edit', recurring('Internet'), date('2026-01-01'));

    await materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    const edited = await patchBilling(
      db,
      OWNER,
      billing.id,
      {
        totalCents: 12_000,
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId, notify: false },
            { kind: SplitPartKind.User, userId: carlaId, notify: false }
          ]
        }
      },
      date('2026-02-10')
    );

    deepEqual(await allocationFlags(billing.id), [
      [anaId, false],
      [brunoId, false],
      [carlaId, false]
    ]);
    deepEqual(
      edited.allocations.map((allocation) => allocation.notify),
      [false, false, false]
    );
    equal(
      (await chargeRows(billing.id)).find((row) => row.debtor_id === brunoId)?.notify,
      false,
      'the value sent reaches the pending charge'
    );
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: brunoId }],
      'whoever enters takes the value without an event, like at creation'
    );

    await patchBilling(
      db,
      OWNER,
      billing.id,
      {
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId, notify: true },
            { kind: SplitPartKind.User, userId: brunoId, notify: false }
          ]
        }
      },
      date('2026-02-11')
    );

    equal((await chargeRows(billing.id)).find((row) => row.debtor_id === anaId)?.notify, true);
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_unsilenced')).map((event) => event.payload),
      [{ userId: anaId }]
    );
    equal((await EventRepository.list(db, billing.id, 'billing.participant_silenced')).length, 1, 'the same value records nothing');
  });

  it('switches a participant on the allocation and on their pending charges only', async () => {
    const billing = await createBilling(
      db,
      OWNER,
      'silenced-participant',
      {
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        description: 'Parcelas',
        totalCents: 3_000,
        startDate: '2026-03-10',
        endDate: '2026-05-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-01')
    );
    const paid = billing.charges[0]!.id;
    const cancelled = billing.charges[1]!.id;
    const stamp = new Date().toISOString();

    await db.charges.updateOne({ where: { id: paid }, data: { state: ChargeState.Paid, paid_at: stamp, updated_at: stamp } });
    await db.charges.updateOne({
      where: { id: cancelled },
      data: { state: ChargeState.Cancelled, cancelled_at: stamp, updated_at: stamp }
    });

    const quieted = await setParticipantNotify(db, OWNER, billing.id, anaId, false, date('2026-03-02'));

    deepEqual(
      quieted.allocations.map((allocation) => allocation.notify),
      [false]
    );
    deepEqual(
      quieted.charges.map((charge) => [charge.state, charge.notify]),
      [
        ['paid', true],
        ['cancelled', true],
        ['pending', false]
      ]
    );
    deepEqual(
      (await chargeRows(billing.id)).map((row) => row.notify),
      [true, true, false],
      'paid and cancelled charges keep the value they were created with'
    );

    await setParticipantNotify(db, OWNER, billing.id, anaId, false, date('2026-03-03'));

    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: anaId }],
      'the same value records nothing'
    );

    const resumed = await setParticipantNotify(db, OWNER, billing.id, anaId, true, date('2026-03-04'));

    deepEqual(
      resumed.charges.map((charge) => charge.notify),
      [true, true, true]
    );
    equal((await EventRepository.list(db, billing.id, 'billing.participant_unsilenced')).length, 1);
  });

  it('refuses another owner, a non-participant and a conta a pagar on the participant route', async () => {
    const billing = await createBilling(
      db,
      OWNER,
      'silenced-refusals',
      {
        recurrence: BillingRecurrence.Once,
        description: 'Jantar',
        totalCents: 2_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-01')
    );
    const payable = await createBilling(db, OWNER, 'silenced-refusals-payable', payableOnce('Luz'), date('2026-03-01'));

    await rejects(() => setParticipantNotify(db, OTHER, billing.id, anaId, false), HttpNotFoundError);
    await rejects(() => setParticipantNotify(db, OWNER, billing.id, carlaId, false), HttpNotFoundError);
    await rejects(() => setParticipantNotify(db, OWNER, payable.id, anaId, false), SilenceUnavailableError);

    equal(await db.events.count({ where: { eventable_id: billing.id, type: 'billing.participant_silenced' } }), 0);
  });

  it('switches one charge for its creditor and nobody else', async () => {
    const billing = await createBilling(
      db,
      OWNER,
      'silenced-charge',
      {
        recurrence: BillingRecurrence.Once,
        description: 'Pizza',
        totalCents: 4_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId }
          ]
        }
      },
      date('2026-03-01')
    );
    const target = billing.charges.find((charge) => charge.debtorId === anaId)!;
    const detail = await charges.setNotify(OWNER, target.id, false);

    equal(detail.notify, false);
    deepEqual(
      (await chargeRows(billing.id)).filter((row) => row.notify === false).map((row) => row.id),
      [target.id]
    );
    deepEqual(await allocationFlags(billing.id), [
      [anaId, true],
      [brunoId, true]
    ]);

    await charges.setNotify(OWNER, target.id, false);

    equal((await EventRepository.list(db, target.id, 'charge.silenced')).length, 1, 'the same value records nothing');

    await charges.setNotify(OWNER, target.id, true);

    equal((await EventRepository.list(db, target.id, 'charge.unsilenced')).length, 1);

    await rejects(() => charges.setNotify(OTHER, target.id, false), HttpNotFoundError);
    await rejects(() => charges.setNotify(anaId, target.id, false), HttpNotFoundError);

    await charges.pay(OWNER, target.id);
    await rejects(() => charges.setNotify(OWNER, target.id, false), ChargeClosedError);

    const payable = await createBilling(db, OWNER, 'silenced-charge-payable', payableOnce('Água'), date('2026-03-01'));

    await rejects(() => charges.setNotify(OWNER, payable.charges[0]!.id, false), SilenceUnavailableError);
  });

  it('moves the leftover pending charges of someone removed and added back with a value', async () => {
    const billing = await createBilling(db, OWNER, 'silenced-readd', recurring('Academia'), date('2026-01-01'));

    await materializeNextOccurrence(db, billing.id, date('2026-02-01'));
    await patchBilling(
      db,
      OWNER,
      billing.id,
      { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } },
      date('2026-02-10')
    );

    const leftover = (await chargeRows(billing.id)).find((row) => row.debtor_id === brunoId);

    equal(leftover?.state, ChargeState.Pending, 'a next-month edit keeps the charge of whoever left');
    equal(leftover?.notify === false, false);

    await patchBilling(
      db,
      OWNER,
      billing.id,
      {
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId, notify: false }
          ]
        }
      },
      date('2026-02-11')
    );

    deepEqual(await allocationFlags(billing.id), [
      [anaId, false],
      [brunoId, false]
    ]);
    equal(
      (await chargeRows(billing.id)).find((row) => row.debtor_id === brunoId)?.notify,
      false,
      'the value sent reaches the leftover charge'
    );
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: brunoId }]
    );
  });

  it('keeps every participant value when a guest joins by the invite and copies it to the new charges', async () => {
    const now = date('2026-01-02');
    const billing = await createBilling(db, OWNER, 'silenced-invite', recurring('Streaming'), date('2026-01-01'));
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const joined = await acceptInvite(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(joined.joinedSplit, true);
    deepEqual(await allocationFlags(billing.id), [
      [anaId, false],
      [brunoId, true],
      [GUEST, true]
    ]);

    await materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    const rows = await chargeRows(billing.id);

    equal(rows.length, 3);
    equal(rows.find((row) => row.debtor_id === anaId)?.notify, false);
    equal(rows.find((row) => row.debtor_id === brunoId)?.notify === false, false);
    equal(rows.find((row) => row.debtor_id === GUEST)?.notify === false, false);
  });

  it('copies the participant value to the charges an edit of the current month creates', async () => {
    const billing = await createBilling(db, OWNER, 'silenced-current-month', recurring('Condomínio'), date('2026-01-01'));

    await materializeNextOccurrence(db, billing.id, date('2026-02-01'));
    await patchBilling(
      db,
      OWNER,
      billing.id,
      {
        applyTo: EditScope.CurrentMonth,
        totalCents: 15_000,
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId },
            { kind: SplitPartKind.User, userId: carlaId, notify: false }
          ]
        }
      },
      date('2026-02-10')
    );

    const rows = await chargeRows(billing.id);

    equal(rows.length, 3, 'the month gains the charge of whoever entered');
    equal(rows.find((row) => row.debtor_id === anaId)?.notify, false);
    equal(rows.find((row) => row.debtor_id === brunoId)?.notify === false, false);
    equal(rows.find((row) => row.debtor_id === carlaId)?.notify, false);
  });
});
