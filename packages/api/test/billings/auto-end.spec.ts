import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BillingCategory, BillingFrequency, BillingKind, BillingRecurrence, BillingState, SplitMode, SplitPartKind } from '@receivy/common';
import { BillingEndedError } from '../../src/billings/errors';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { charges, cleanupUsers, contacts, createUser, db } from '../fixtures/financial';

const OWNER = '99999999-9999-4999-8999-999999999991';
const TIMEZONE = 'America/Sao_Paulo';

async function stateOf(id: string) {
  const row = await db.billings.findOne({ select: { state: true, auto_ended_at: true }, where: { id } });

  return { state: row?.state, settled: Boolean(row?.auto_ended_at) };
}

async function billingEvents(id: string, type: string) {
  return db.events.count({ where: { eventable_id: id, type } });
}

describe('finite billings end on their own once nothing is pending', () => {
  let ana: string;
  let bruno: string;

  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.name, 'receivy_tests', 'integration tests must use the dedicated test database');

    await createUser(db, { id: OWNER, email: 'auto-end-owner@example.com', name: 'Dona Conta' });

    ana = (await contacts.save(OWNER, { name: 'Ana Auto', email: 'auto-end-ana@example.com' })).userId;
    bruno = (await contacts.save(OWNER, { name: 'Bruno Auto', email: 'auto-end-bruno@example.com' })).userId;
  });

  after(async () => cleanupUsers(db, [OWNER]));

  it('ends an única when the last charge is paid or cancelled, and comes back when a paid one reopens', async () => {
    const billing = await createBilling(db, OWNER, 'auto-end-once', {
      recurrence: BillingRecurrence.Once,
      totalCents: 10_000,
      startDate: '2026-10-10',
      timezone: TIMEZONE,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: ana }, { kind: SplitPartKind.User, userId: bruno }] }
    });
    const [first, second] = billing.charges;

    await charges.pay(OWNER, first!.id);

    equal((await stateOf(billing.id)).state, BillingState.Active, 'one charge is still pending');

    await charges.cancel(OWNER, second!.id);

    const ended = await stateOf(billing.id);

    equal(ended.state, BillingState.Ended, 'paid plus cancelled leaves nothing pending');
    ok(ended.settled);
    equal(await billingEvents(billing.id, 'billing.auto_ended'), 1);

    await charges.reopen(OWNER, first!.id);

    const reopened = await stateOf(billing.id);

    equal(reopened.state, BillingState.Active, 'a reopened charge brings the billing back');
    equal(reopened.settled, false);
    equal(await billingEvents(billing.id, 'billing.reopened'), 1);
  });

  it('keeps an única whose charges were all cancelled, since nothing was paid', async () => {
    const billing = await createBilling(db, OWNER, 'auto-end-cancelled', {
      recurrence: BillingRecurrence.Once,
      totalCents: 5_000,
      startDate: '2026-10-11',
      timezone: TIMEZONE,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: ana }] }
    });

    await charges.cancel(OWNER, billing.charges[0]!.id);

    equal((await stateOf(billing.id)).state, BillingState.Active);
  });

  it('ends a parcelada only after its last installment', async () => {
    const billing = await createBilling(db, OWNER, 'auto-end-until', {
      recurrence: BillingRecurrence.Until,
      frequency: BillingFrequency.Monthly,
      totalCents: 3_000,
      startDate: '2026-10-05',
      endDate: '2026-11-05',
      timezone: TIMEZONE,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: ana }] }
    });

    equal(billing.charges.length, 2);

    await charges.pay(OWNER, billing.charges[0]!.id);

    equal((await stateOf(billing.id)).state, BillingState.Active);

    await charges.pay(OWNER, billing.charges[1]!.id);

    equal((await stateOf(billing.id)).state, BillingState.Ended);
  });

  it('ends a registro única at creation and still takes edits, never a move back to active', async () => {
    const billing = await createBilling(db, OWNER, 'auto-end-registro', {
      recurrence: BillingRecurrence.Once,
      description: 'Freela',
      category: BillingCategory.Income,
      totalCents: 8_000,
      // A registro settles on its own due date: one already past is paid at creation.
      startDate: '2026-09-02',
      timezone: TIMEZONE,
      kind: BillingKind.Record,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: ana }] }
    });

    const ended = await stateOf(billing.id);

    equal(ended.state, BillingState.Ended);
    ok(ended.settled);
    // What the snapshot rules already allowed still goes through; an ended-by-hand billing would refuse it.
    equal((await patchBilling(db, OWNER, billing.id, { kind: BillingKind.Record }, new Date())).kind, BillingKind.Record);
    await rejects(() => patchBilling(db, OWNER, billing.id, { state: BillingState.Active }, new Date()), BillingEndedError);
  });

  it('never ends a recorrente, and leaves a billing ended by hand ended when a charge reopens', async () => {
    const recurring = await createBilling(db, OWNER, 'auto-end-indefinite', {
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      totalCents: 2_000,
      startDate: '2026-10-01',
      timezone: TIMEZONE,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: ana }] }
    });

    for (const charge of recurring.charges) {
      await charges.pay(OWNER, charge.id);
    }

    equal((await stateOf(recurring.id)).state, BillingState.Active);

    const byHand = await createBilling(db, OWNER, 'auto-end-by-hand', {
      recurrence: BillingRecurrence.Once,
      totalCents: 4_000,
      startDate: '2026-10-12',
      timezone: TIMEZONE,
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: bruno }] }
    });

    await charges.pay(OWNER, byHand.charges[0]!.id);
    // Simulates an owner who ended it before the automatic end existed: no `auto_ended_at`.
    await BillingRepository.update(db, byHand.id, { state: BillingState.Ended }, new Date().toISOString());
    await db.billings.updateOne({ where: { id: byHand.id }, data: { auto_ended_at: null as unknown as undefined } });
    await charges.reopen(OWNER, byHand.charges[0]!.id);

    equal((await stateOf(byHand.id)).state, BillingState.Ended);
  });
});
