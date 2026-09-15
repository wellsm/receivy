import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import {
  BillingFrequency,
  type BillingInput,
  BillingType,
  ChargeState,
  Direction,
  EditScope,
  PixKeyType,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeClosedError, SilenceUnavailableError } from '../../src/charges/errors';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { InviteRepository } from '../../src/invites/repositories/invite';
import { createInvite } from '../../src/invites/services/links';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

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

/** A monthly recorrente starting in February, with Ana silenced and Bruno notified. */
function recurring(key: string, overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: BillingType.Indefinite,
    frequency: BillingFrequency.Monthly,
    description: key,
    totalCents: 10_000,
    startDate: '2026-02-15',
    timezone: TZ,
    paymentMethodId: pixId,
    split: {
      mode: SplitMode.Equal,
      parts: [
        { kind: SplitPartKind.User, userId: anaId, silenced: true },
        { kind: SplitPartKind.User, userId: brunoId }
      ]
    },
    ...overrides
  };
}

async function chargeRows(billingId: string) {
  const { records } = await db.charges.findMany({
    select: { id: true, debtor_user_id: true, due_date: true, state: true, silenced: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return records;
}

async function allocationFlags(billingId: string) {
  const { records } = await db.allocations.findMany({
    select: { user_id: true, silenced: true },
    where: { billing_id: billingId, kind: SplitPartKind.User },
    order: { allocation_order: Order.Asc }
  });

  return records.map((row) => [row.user_id, row.silenced === true]);
}

/** The owner's own bill, owed to Ana: nothing here has notices to pause. */
function payableOnce(key: string): BillingInput {
  return {
    type: BillingType.Once,
    direction: Direction.Payable,
    description: key,
    totalCents: 5_000,
    startDate: '2026-03-10',
    timezone: TZ,
    payeeUserId: anaId
  };
}

describe('sem avisos on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'silenced-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'silenced-other@example.com', name: 'Outra' });
    await createUser(db, { id: GUEST, email: 'silenced-guest@example.com', name: 'Gabi' });

    const ana = await ContactRepository.save(db, OWNER, { name: 'Ana', email: 'silenced-ana@example.com' });

    anaId = ana.userId;
    anaContactId = ana.id;
    brunoId = (await ContactRepository.save(db, OWNER, { name: 'Bruno', email: 'silenced-bruno@example.com' })).userId;
    carlaId = (await ContactRepository.save(db, OWNER, { name: 'Carla', email: 'silenced-carla@example.com' })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER, GUEST]));

  it('copies a silenced participant to the allocation and to every charge created for them', async () => {
    const created = await BillingRepository.create(
      db,
      OWNER,
      'silenced-create',
      {
        type: BillingType.Until,
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
            { kind: SplitPartKind.User, userId: anaId, silenced: true, amountCents: 3_000 },
            { kind: SplitPartKind.User, userId: brunoId, amountCents: 3_000 }
          ]
        }
      },
      date('2026-03-01')
    );

    deepEqual(await allocationFlags(created.id), [
      [anaId, true],
      [brunoId, false]
    ]);
    deepEqual(
      created.allocations.map((allocation) => [allocation.kind, allocation.silenced]),
      [
        ['user', true],
        ['user', false],
        ['owner', false]
      ]
    );

    const rows = await chargeRows(created.id);

    equal(rows.length, 4);
    ok(rows.filter((row) => row.debtor_user_id === anaId).every((row) => row.silenced === true));
    ok(rows.filter((row) => row.debtor_user_id === brunoId).every((row) => row.silenced !== true));

    const anaCharge = created.charges.find((charge) => charge.debtorUserId === anaId)!;

    equal(anaCharge.silenced, true);
    equal(created.charges.find((charge) => charge.debtorUserId === brunoId)!.silenced, false);
    equal((await ChargeRepository.get(db, anaId, anaCharge.id)).silenced, false, 'whoever owes sees no difference');

    const ledger = await TimelineRepository.contactLedger(db, OWNER, anaContactId);

    equal(ledger.charges.find((charge) => charge.id === anaCharge.id)?.silenced, true);
  });

  it('copies the participant value to the charges of each new month', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'silenced-monthly', recurring('Aluguel'), date('2026-01-01'));
    const done = await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    equal(done.materialized, true);

    const rows = await chargeRows(billing.id);

    equal(rows.length, 2);
    equal(rows.find((row) => row.debtor_user_id === anaId)?.silenced, true);
    equal(rows.find((row) => row.debtor_user_id === brunoId)?.silenced === true, false);
  });

  it('keeps the value of whoever stays, applies the one sent and moves their pending charges', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'silenced-edit', recurring('Internet'), date('2026-01-01'));

    await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    const edited = await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        totalCents: 12_000,
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId, silenced: true },
            { kind: SplitPartKind.User, userId: carlaId, silenced: true }
          ]
        }
      },
      date('2026-02-10')
    );

    deepEqual(await allocationFlags(billing.id), [
      [anaId, true],
      [brunoId, true],
      [carlaId, true]
    ]);
    deepEqual(
      edited.allocations.map((allocation) => allocation.silenced),
      [true, true, true]
    );
    equal(
      (await chargeRows(billing.id)).find((row) => row.debtor_user_id === brunoId)?.silenced,
      true,
      'the value sent reaches the pending charge'
    );
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: brunoId }],
      'whoever enters takes the value without an event, like at creation'
    );

    await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId, silenced: false },
            { kind: SplitPartKind.User, userId: brunoId, silenced: true }
          ]
        }
      },
      date('2026-02-11')
    );

    equal((await chargeRows(billing.id)).find((row) => row.debtor_user_id === anaId)?.silenced, false);
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_unsilenced')).map((event) => event.payload),
      [{ userId: anaId }]
    );
    equal((await EventRepository.list(db, billing.id, 'billing.participant_silenced')).length, 1, 'the same value records nothing');
  });

  it('switches a participant on the allocation and on their pending charges only', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'silenced-participant',
      {
        type: BillingType.Until,
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

    const silenced = await BillingRepository.silenceParticipant(db, OWNER, billing.id, anaId, true, date('2026-03-02'));

    deepEqual(
      silenced.allocations.map((allocation) => allocation.silenced),
      [true]
    );
    deepEqual(
      silenced.charges.map((charge) => [charge.state, charge.silenced]),
      [
        ['paid', false],
        ['cancelled', false],
        ['pending', true]
      ]
    );
    deepEqual(
      (await chargeRows(billing.id)).map((row) => row.silenced ?? null),
      [null, null, true],
      'paid and cancelled charges are never written'
    );

    await BillingRepository.silenceParticipant(db, OWNER, billing.id, anaId, true, date('2026-03-03'));

    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: anaId }],
      'the same value records nothing'
    );

    const resumed = await BillingRepository.silenceParticipant(db, OWNER, billing.id, anaId, false, date('2026-03-04'));

    deepEqual(
      resumed.charges.map((charge) => charge.silenced),
      [false, false, false]
    );
    equal((await EventRepository.list(db, billing.id, 'billing.participant_unsilenced')).length, 1);
  });

  it('refuses another owner, a non-participant and a conta a pagar on the participant route', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'silenced-refusals',
      {
        type: BillingType.Once,
        description: 'Jantar',
        totalCents: 2_000,
        startDate: '2026-03-10',
        timezone: TZ,
        paymentMethodId: pixId,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] }
      },
      date('2026-03-01')
    );
    const payable = await BillingRepository.create(db, OWNER, 'silenced-refusals-payable', payableOnce('Luz'), date('2026-03-01'));

    await rejects(() => BillingRepository.silenceParticipant(db, OTHER, billing.id, anaId, true), HttpNotFoundError);
    await rejects(() => BillingRepository.silenceParticipant(db, OWNER, billing.id, carlaId, true), HttpNotFoundError);
    await rejects(() => BillingRepository.silenceParticipant(db, OWNER, payable.id, anaId, true), SilenceUnavailableError);
    equal(await db.events.count({ where: { eventable_id: billing.id, type: 'billing.participant_silenced' } }), 0);
  });

  it('switches one charge for its creditor and nobody else', async () => {
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'silenced-charge',
      {
        type: BillingType.Once,
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
    const target = billing.charges.find((charge) => charge.debtorUserId === anaId)!;
    const detail = await ChargeRepository.silence(db, OWNER, target.id, true);

    equal(detail.silenced, true);
    deepEqual(
      (await chargeRows(billing.id)).filter((row) => row.silenced === true).map((row) => row.id),
      [target.id]
    );
    deepEqual(await allocationFlags(billing.id), [
      [anaId, false],
      [brunoId, false]
    ]);

    await ChargeRepository.silence(db, OWNER, target.id, true);

    equal((await EventRepository.list(db, target.id, 'charge.silenced')).length, 1, 'the same value records nothing');

    await ChargeRepository.silence(db, OWNER, target.id, false);

    equal((await EventRepository.list(db, target.id, 'charge.unsilenced')).length, 1);
    await rejects(() => ChargeRepository.silence(db, OTHER, target.id, true), HttpNotFoundError);
    await rejects(() => ChargeRepository.silence(db, anaId, target.id, true), HttpNotFoundError);

    await ChargeRepository.pay(db, OWNER, target.id);
    await rejects(() => ChargeRepository.silence(db, OWNER, target.id, true), ChargeClosedError);

    const payable = await BillingRepository.create(db, OWNER, 'silenced-charge-payable', payableOnce('Água'), date('2026-03-01'));

    await rejects(() => ChargeRepository.silence(db, OWNER, payable.charges[0]!.id, true), SilenceUnavailableError);
  });

  it('moves the leftover pending charges of someone removed and added back with a value', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'silenced-readd', recurring('Academia'), date('2026-01-01'));

    await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));
    await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: anaId }] } },
      date('2026-02-10')
    );

    const leftover = (await chargeRows(billing.id)).find((row) => row.debtor_user_id === brunoId);

    equal(leftover?.state, ChargeState.Pending, 'a next-month edit keeps the charge of whoever left');
    equal(leftover?.silenced === true, false);

    await BillingRepository.patch(
      db,
      OWNER,
      billing.id,
      {
        split: {
          mode: SplitMode.Equal,
          parts: [
            { kind: SplitPartKind.User, userId: anaId },
            { kind: SplitPartKind.User, userId: brunoId, silenced: true }
          ]
        }
      },
      date('2026-02-11')
    );

    deepEqual(await allocationFlags(billing.id), [
      [anaId, true],
      [brunoId, true]
    ]);
    equal(
      (await chargeRows(billing.id)).find((row) => row.debtor_user_id === brunoId)?.silenced,
      true,
      'the value sent reaches the leftover charge'
    );
    deepEqual(
      (await EventRepository.list(db, billing.id, 'billing.participant_silenced')).map((event) => event.payload),
      [{ userId: brunoId }]
    );
  });

  it('keeps every participant value when a guest joins by the invite and copies it to the new charges', async () => {
    const now = date('2026-01-02');
    const billing = await BillingRepository.create(db, OWNER, 'silenced-invite', recurring('Streaming'), date('2026-01-01'));
    const invite = await createInvite(db, OWNER, billing.id, SECRET, ORIGIN, now);
    const joined = await InviteRepository.accept(db, GUEST, tokenOf(invite.url), SECRET, now);

    equal(joined.joinedSplit, true);
    deepEqual(await allocationFlags(billing.id), [
      [anaId, true],
      [brunoId, false],
      [GUEST, false]
    ]);

    await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));

    const rows = await chargeRows(billing.id);

    equal(rows.length, 3);
    equal(rows.find((row) => row.debtor_user_id === anaId)?.silenced, true);
    equal(rows.find((row) => row.debtor_user_id === brunoId)?.silenced === true, false);
    equal(rows.find((row) => row.debtor_user_id === GUEST)?.silenced === true, false);
  });

  it('copies the participant value to the charges an edit of the current month creates', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'silenced-current-month', recurring('Condomínio'), date('2026-01-01'));

    await BillingRepository.materializeNextOccurrence(db, billing.id, date('2026-02-01'));
    await BillingRepository.patch(
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
            { kind: SplitPartKind.User, userId: carlaId, silenced: true }
          ]
        }
      },
      date('2026-02-10')
    );

    const rows = await chargeRows(billing.id);

    equal(rows.length, 3, 'the month gains the charge of whoever entered');
    equal(rows.find((row) => row.debtor_user_id === anaId)?.silenced, true);
    equal(rows.find((row) => row.debtor_user_id === brunoId)?.silenced === true, false);
    equal(rows.find((row) => row.debtor_user_id === carlaId)?.silenced, true);
  });
});
