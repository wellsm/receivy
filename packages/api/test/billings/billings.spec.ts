import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import type { BillingInput, BillingSplit } from '@receivy/common';
import {
  BillingCategory,
  BillingDueRule,
  BillingFrequency,
  BillingState,
  BillingRecurrence,
  billingDueLabel,
  ChargeState,
  DEFAULT_BILLING_REMINDERS,
  PixKeyType,
  ProofKind,
  ProofMime,
  resolveBillingSplit,
  SplitMode,
  SplitPartKind
} from '@receivy/common';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { getBilling, listBillings } from '../../src/billings/services/detail';
import { materializeNextOccurrence } from '../../src/billings/services/materialize';
import { StoredProofState } from '../../src/charges/schemas/charge';
import { ApiError } from '../../src/common/errors';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { charges, cleanupUsers, contacts, createUser, db, monthCharges, paymentMethods } from '../fixtures/financial';

const OWNER = 'b1111111-1111-4111-8111-111111111111';
const OTHER = 'b2222222-2222-4222-8222-222222222222';
const date = (value: string) => new Date(`${value}T12:00:00Z`);

let debtorId: string;
let debtorContactId: string;
let pixId: string;
let sharesId: string;

function once(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    recurrence: BillingRecurrence.Once,
    description: 'Jantar',
    totalCents: 9_000,
    startDate: '2026-10-31',
    timezone: 'America/Sao_Paulo',
    paymentMethodId: pixId,
    split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: debtorId, amountCents: 6_001 }] },
    ...overrides
  };
}

describe('billings on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'billing-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'billing-other@example.com', name: 'Outra' });

    const debtor = await contacts.save(OWNER, { name: 'Bruno', email: 'billing-debtor@example.com' });

    debtorId = debtor.userId;
    debtorContactId = debtor.id;
    pixId = (await paymentMethods.save(OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER]));

  it('creates a once billing with one numbered charge, a live recipient, Pix snapshots and idempotent replay', async () => {
    const created = await createBilling(db, OWNER, 'once-key', once());

    equal(created.recurrence, 'once');
    equal(created.installmentCount, 1);
    deepEqual(
      created.charges.map((charge) => [charge.amount.amountCents, charge.installment, charge.installmentCount]),
      [[6_001, 1, 1]]
    );
    equal(created.charges[0]!.recurrence, 'once');
    equal((await createBilling(db, OWNER, 'once-key', once())).id, created.id);

    await rejects(() => createBilling(db, OWNER, 'once-key', once({ totalCents: 9_001 })), ApiError);
    await rejects(() => getBilling(db, OTHER, created.id), HttpNotFoundError);
    // The counterpart is the account itself: a pending contact edit is read live, while the Pix key stays a snapshot.
    await contacts.save(OWNER, { name: 'Bruno Editado', email: 'billing-edited@example.com' }, debtorContactId);

    const snapshot = await charges.get(OWNER, created.charges[0]!.id);

    deepEqual(snapshot.recipient, { userId: debtorId, name: 'Bruno Editado', email: 'billing-edited@example.com', avatar: null });
    equal(snapshot.debtorId, debtorId);
    equal(snapshot.pix?.key, '52998224725');

    await contacts.save(OWNER, { name: 'Bruno', email: 'billing-debtor@example.com' }, debtorContactId);

    equal(await db.events.count({ where: { eventable_id: created.charges[0]!.id, type: 'charge.created' } }), 1);
  });

  it('creates every occurrence of an until billing at once with exact per-occurrence cents and clamped days', async () => {
    const created = await createBilling(db, OWNER, 'until-key', {
      ...once({ description: 'Aluguel', totalCents: 1_001 }),
      recurrence: BillingRecurrence.Until,
      frequency: BillingFrequency.Monthly,
      startDate: '2026-01-31',
      endDate: '2026-03-31',
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: debtorId }, { kind: SplitPartKind.Owner }] }
    });

    equal(created.installmentCount, 3);
    deepEqual(
      created.charges.map((charge) => [charge.dueDate, charge.amount.amountCents, charge.installment, charge.installmentCount]),
      [
        ['2026-01-31', 501, 1, 3],
        ['2026-02-28', 501, 2, 3],
        ['2026-03-31', 501, 3, 3]
      ]
    );

    await rejects(
      () =>
        createBilling(db, OWNER, 'until-too-long', {
          ...once(),
          recurrence: BillingRecurrence.Until,
          frequency: BillingFrequency.Monthly,
          startDate: '2026-01-01',
          endDate: '2040-01-01'
        }),
      RangeError
    );
    await rejects(
      () =>
        createBilling(db, OWNER, 'until-backwards', {
          ...once(),
          recurrence: BillingRecurrence.Until,
          frequency: BillingFrequency.Monthly,
          startDate: '2026-03-01',
          endDate: '2026-01-01'
        }),
      RangeError
    );
    await rejects(() => patchBilling(db, OWNER, created.id, { totalCents: 2_000 }), ApiError);

    const ended = await patchBilling(db, OWNER, created.id, { state: BillingState.Ended });

    equal(ended.state, 'ended');
    deepEqual(
      ended.charges.map((charge) => charge.state),
      ['cancelled', 'cancelled', 'cancelled']
    );

    await rejects(() => patchBilling(db, OWNER, created.id, { reminders: [] }), ApiError);
  });

  it('lands until and indefinite occurrences on the last day of each month with an end_of_month rule', async () => {
    const until = await createBilling(
      db,
      OWNER,
      'month-end-until',
      {
        ...once({ description: 'Aluguel' }),
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-09-30',
        endDate: '2026-11-30',
        dueRule: BillingDueRule.EndOfMonth
      },
      date('2026-09-01')
    );

    equal(until.dueRule, 'end_of_month');
    deepEqual(
      until.charges.map((charge) => charge.dueDate),
      ['2026-09-30', '2026-10-31', '2026-11-30']
    );

    await rejects(() => patchBilling(db, OWNER, until.id, { dueRule: BillingDueRule.Fixed }), ApiError);
    await rejects(
      () =>
        createBilling(
          db,
          OWNER,
          'month-end-yearly',
          {
            ...once(),
            recurrence: BillingRecurrence.Indefinite,
            frequency: BillingFrequency.Yearly,
            startDate: '2026-09-30',
            dueRule: BillingDueRule.EndOfMonth
          },
          date('2026-09-01')
        ),
      RangeError
    );
    await rejects(
      () =>
        createBilling(db, OWNER, 'month-end-wrong-day', {
          ...once(),
          startDate: '2026-10-30',
          dueRule: BillingDueRule.EndOfMonth
        }),
      RangeError
    );

    const rent = await createBilling(
      db,
      OWNER,
      'month-end-rent',
      { ...once({ description: 'Aluguel' }), recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2026-09-15' },
      date('2026-09-01')
    );

    equal(rent.dueRule, 'fixed');
    deepEqual(
      rent.charges.map((charge) => charge.dueDate),
      ['2026-09-15'],
      'the month of creation already has its charge'
    );

    const switched = await patchBilling(
      db,
      OWNER,
      rent.id,
      { dueRule: BillingDueRule.EndOfMonth, startDate: '2026-09-30' },
      date('2026-09-16')
    );

    equal(switched.dueRule, 'end_of_month');
    deepEqual(
      switched.previews.map((preview) => preview.occurrenceDate).slice(0, 3),
      ['2026-10-31', '2026-11-30'],
      'September already has its charge: the new day starts next month'
    );
    equal(switched.charges.length, 1);
    equal(switched.charges[0]!.dueDate, '2026-09-15', 'generated charges keep their date');

    await rejects(
      () =>
        patchBilling(db, OWNER, rent.id, { dueRule: BillingDueRule.EndOfMonth, startDate: '2026-10-30' }, date('2026-09-16')),
      RangeError
    );

    await patchBilling(db, OWNER, rent.id, { state: BillingState.Ended });
    await patchBilling(db, OWNER, until.id, { state: BillingState.Ended });
  });

  it('materializes indefinite billings one occurrence at a time without duplicates and honors pause', async () => {
    const created = await createBilling(
      db,
      OWNER,
      'indefinite-key',
      {
        ...once({ description: 'Mensal', totalCents: 1_001 }),
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-01-31',
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: debtorId }, { kind: SplitPartKind.Owner }] }
      },
      date('2026-01-01')
    );

    equal(created.charges.length, 1, 'January exists from creation');
    ok(created.previews.length > 0);

    await rejects(
      () =>
        createBilling(
          db,
          OWNER,
          'indefinite-past',
          { ...once(), recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: '2025-01-01' },
          date('2026-01-01')
        ),
      RangeError
    );
    await Promise.all([
      materializeNextOccurrence(db, created.id, date('2026-01-31')),
      materializeNextOccurrence(db, created.id, date('2026-01-31'))
    ]);

    const charges = await db.charges.findMany({ select: { due_date: true, installment: true }, where: { billing_id: created.id } });

    equal(charges.records.length, 1);
    equal(charges.records[0]!.due_date, '2026-01-31');
    ok(charges.records[0]!.installment == null);

    const paused = await patchBilling(db, OWNER, created.id, { state: BillingState.Paused }, date('2026-02-01'));

    equal(paused.state, 'paused');

    await materializeNextOccurrence(db, created.id, date('2026-03-31'));

    equal(await db.charges.count({ where: { billing_id: created.id } }), 1);

    await patchBilling(db, OWNER, created.id, { state: BillingState.Active }, date('2026-04-01'));
    await materializeNextOccurrence(db, created.id, date('2026-04-30'));

    deepEqual(
      (
        await db.charges.findMany({ select: { due_date: true }, where: { billing_id: created.id }, order: { due_date: Order.Asc } })
      ).records.map((row) => row.due_date),
      ['2026-01-31', '2026-04-30']
    );

    await patchBilling(db, OWNER, created.id, { state: BillingState.Ended });
  });

  it('edits future occurrences of an indefinite billing and rolls back unavailable recipients without starving others', async () => {
    const archived = await contacts.save(OWNER, { name: 'Arquivado', email: 'billing-archived@example.com' });
    const invalid = await createBilling(
      db,
      OWNER,
      'invalid-key',
      {
        ...once(),
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-02-15',
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: archived.userId }] }
      },
      date('2026-01-01')
    );
    const valid = await createBilling(
      db,
      OWNER,
      'valid-key',
      {
        ...once({ totalCents: 2_000 }),
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-02-15',
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: debtorId }] }
      },
      date('2026-01-01')
    );

    await contacts.archive(OWNER, archived.id);

    const skipped = await materializeNextOccurrence(db, invalid.id, date('2026-02-01'));
    const done = await materializeNextOccurrence(db, valid.id, date('2026-02-01'));

    ok(skipped.skipped, 'an archived recipient never throws out of the consumer');
    equal(done.materialized, true);
    equal((await db.billings.findOne({ select: { last_occurrence_date: true }, where: { id: invalid.id } }))?.last_occurrence_date, '2025-12-31');

    const edited = await patchBilling(
      db,
      OWNER,
      valid.id,
      { description: 'Editada', totalCents: 3_000, reminders: [{ offsetDays: -5, enabled: true }] },
      date('2026-02-16')
    );

    equal(edited.description, 'Editada');
    deepEqual(edited.reminders, [{ offsetDays: -5, enabled: true }]);
    equal((await charges.get(OWNER, edited.charges[0]!.id)).amount.amountCents, 2_000, 'materialized charges stay snapshots');

    await patchBilling(db, OWNER, invalid.id, { state: BillingState.Ended });
    await patchBilling(db, OWNER, valid.id, { state: BillingState.Ended });
  });

  it('lists the owner billings newest first, and nothing for a stranger', async () => {
    const page = await listBillings(db, OWNER);

    ok(page.billings.length >= 2);
    deepEqual(await listBillings(db, OTHER), { billings: [], nextCursor: null });
  });

  it('persists a category and a shares split with one charge per quota', async () => {
    const [second, third, fourth] = await Promise.all([
      contacts.save(OWNER, { name: 'Cota Dois', email: 'billing-quota-2@example.com' }),
      contacts.save(OWNER, { name: 'Cota Tres', email: 'billing-quota-3@example.com' }),
      contacts.save(OWNER, { name: 'Cota Quatro', email: 'billing-quota-4@example.com' })
    ]);
    const split: BillingSplit = {
      mode: SplitMode.Shares,
      parts: [
        { kind: SplitPartKind.User, userId: debtorId, shares: 2 },
        { kind: SplitPartKind.User, userId: second!.userId, shares: 2 },
        { kind: SplitPartKind.User, userId: third!.userId, shares: 1 },
        { kind: SplitPartKind.User, userId: fourth!.userId, shares: 1 }
      ]
    };
    const created = await createBilling(
      db,
      OWNER,
      'shares-key',
      once({ description: 'Churrasco do sábado', totalCents: 12_000, category: BillingCategory.Food, split })
    );

    sharesId = created.id;
    equal(created.category, 'food');
    deepEqual(
      created.charges.map((charge) => charge.amount.amountCents).sort((left, right) => left - right),
      [2_000, 2_000, 4_000, 4_000]
    );
    equal((await db.billings.findOne({ select: { split_mode: true }, where: { id: created.id } }))?.split_mode, 'shares');
    deepEqual(
      (
        await db.allocations.findMany({
          select: { value: true },
          where: { billing_id: created.id },
          order: { sort_order: Order.Asc }
        })
      ).records.map((row) => row.value),
      [2, 2, 1, 1]
    );

    const fetched = await getBilling(db, OWNER, created.id);

    deepEqual(fetched.split, split);
    deepEqual(
      fetched.allocations.map((allocation) => allocation.shares),
      [2, 2, 1, 1]
    );
    equal(fetched.category, 'food');
    equal(fetched.invite, null);

    // The request fingerprint covers the category, so a replay that changes it is a different request.
    await rejects(
      () =>
        createBilling(
          db,
          OWNER,
          'shares-key',
          once({ description: 'Churrasco do sábado', totalCents: 12_000, category: BillingCategory.Travel, split })
        ),
      ApiError
    );
  });

  it('summarizes participants, charges, proofs and the single shareable charge', async () => {
    const summaryOf = async (id: string) => (await listBillings(db, OWNER)).billings.find((billing) => billing.id === id)!;
    const before = await summaryOf(sharesId);

    equal(before.participantCount, 4);
    equal(before.chargeCount, 4);
    equal(before.paidCount, 0);
    equal(before.proofsPending, 0);
    equal(before.shareChargeId, null);

    const charges = await db.charges.findMany({ select: { id: true }, where: { billing_id: sharesId }, order: { id: Order.Asc } });
    const instant = new Date().toISOString();

    await db.charges.updateOne({
      where: { id: charges.records[0]!.id },
      data: { state: ChargeState.Paid, paid_at: instant, updated_at: instant }
    });
    await db.proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: charges.records[1]!.id },
        state: StoredProofState.Pending,
        kind: ProofKind.File,
        file: {
          key: `proofs/${sharesId}/counter.pdf`,
          name: 'counter.pdf',
          mime: ProofMime.Pdf,
          size: 1_024,
          sha256: 'a'.repeat(64)
        },
        actor_hash: 'billings-spec-counter',
        sent_at: instant,
        created_at: instant,
        updated_at: instant
      }
    });

    const after = await summaryOf(sharesId);

    equal(after.paidCount, 1);
    equal(after.proofsPending, 1);
    equal(after.chargeCount, 4);

    const single = await createBilling(
      db,
      OWNER,
      'share-single-key',
      once({ description: 'Cobrança sozinha', category: BillingCategory.Travel })
    );

    equal((await summaryOf(single.id)).shareChargeId, single.charges[0]!.id);
    equal((await summaryOf(single.id)).participantCount, 1);
  });

  it('searches billings by description', async () => {
    deepEqual(
      (await listBillings(db, OWNER, { search: '  CHURRasco  ' })).billings.map((billing) => billing.id),
      [sharesId]
    );
    equal((await listBillings(db, OWNER, { search: 'churrasco do sábado' })).billings.length, 1);
    equal((await listBillings(db, OWNER, { search: 'nada-que-exista' })).billings.length, 0);
    equal((await listBillings(db, OTHER, { search: 'churr' })).billings.length, 0);
    // A date-like term must stay a text parameter instead of being sniffed into a `date` variable.
    equal((await listBillings(db, OWNER, { search: '2026-10-31' })).billings.length, 0);
    equal((await listBillings(db, OWNER, { search: '12:30:00' })).billings.length, 0);

    const dinners = (await listBillings(db, OWNER, { search: 'jantar' })).billings;

    ok(dinners.length >= 2);
    ok(dinners.every((billing) => billing.category === 'other'));

    // The searched page must keep the exact cursor semantics of the unfiltered listing.
    const cursor = Buffer.from(JSON.stringify({ createdAt: dinners[0]!.createdAt, id: dinners[0]!.id })).toString('base64url');
    const paged = await listBillings(db, OWNER, { search: 'jantar', cursor });
    const plain = (await listBillings(db, OWNER, { cursor })).billings.filter((billing) => billing.description === 'Jantar');

    deepEqual(
      paged.billings.map((billing) => billing.id),
      plain.map((billing) => billing.id)
    );
    equal(
      paged.billings.some((billing) => billing.id === dinners[0]!.id),
      false
    );
  });

  it('reports the overdue due date while the share action still points at the next charge', async () => {
    const solo = (await contacts.save(OWNER, { name: 'Atrasado Solo', email: 'billing-overdue-solo@example.com' })).userId;
    const created = await createBilling(
      db,
      OWNER,
      'overdue-key',
      {
        ...once({
          description: 'Parcelas atrasadas',
          totalCents: 3_000,
          split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: solo }] }
        }),
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-01-31',
        endDate: '2026-03-31'
      },
      date('2026-01-01')
    );
    const chargeOn = (dueDate: string) => created.charges.find((charge) => charge.dueDate === dueDate)!.id;
    const partial = (await listBillings(db, OWNER, { search: 'parcelas atrasadas' }, date('2026-02-15'))).billings[0]!;

    equal(partial.nextDueDate, '2026-01-31');
    equal(partial.shareChargeId, chargeOn('2026-02-28'));
    equal((await getBilling(db, OWNER, created.id, date('2026-02-15'))).nextDueDate, '2026-01-31');

    const late = (await listBillings(db, OWNER, { search: 'parcelas atrasadas' }, date('2026-06-01'))).billings[0]!;

    equal(late.nextDueDate, '2026-01-31');
    equal(late.shareChargeId, chargeOn('2026-01-31'), 'every charge overdue falls back to the earliest pending one');
    equal(billingDueLabel(late, '2026-06-01'), 'Atrasado 121 dias');
  });

  it('ignores cancelled charges so an ended billing with every paid occurrence reads as settled', async () => {
    const solo = (await contacts.save(OWNER, { name: 'Liquidado Solo', email: 'billing-settled-solo@example.com' })).userId;
    const created = await createBilling(
      db,
      OWNER,
      'settled-key',
      {
        ...once({
          description: 'Encerrada liquidada',
          totalCents: 3_000,
          split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: solo }] }
        }),
        recurrence: BillingRecurrence.Until,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-01-31',
        endDate: '2026-03-31'
      },
      date('2026-01-01')
    );
    const instant = new Date().toISOString();

    await db.charges.updateOne({
      where: { id: created.charges[0]!.id },
      data: { state: ChargeState.Paid, paid_at: instant, updated_at: instant }
    });
    await patchBilling(db, OWNER, created.id, { state: BillingState.Ended }, date('2026-02-15'));

    const ended = (await listBillings(db, OWNER, { search: 'encerrada liquidada' })).billings[0]!;

    equal(ended.chargeCount, 1);
    equal(ended.paidCount, 1);
    equal(billingDueLabel(ended, '2026-06-01'), 'Liquidada');
  });

  it('answers a page of billings with the same summaries the details report', async () => {
    const solo = (await contacts.save(OWNER, { name: 'Página Solo', email: 'billing-page-solo@example.com' })).userId;
    const forSolo = (description: string) =>
      once({ description, totalCents: 3_000, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: solo }] } });

    for (const [index, description] of ['Página um', 'Página dois', 'Página três'].entries()) {
      await createBilling(db, OWNER, `page-summary-${index}`, forSolo(description), date('2026-03-01'));
    }

    const now = date('2026-03-05');
    const page = await listBillings(db, OWNER, { search: 'página' }, now);

    equal(page.billings.length, 3);

    for (const listed of page.billings) {
      const detail = await getBilling(db, OWNER, listed.id, now);

      equal(listed.nextDueDate, detail.nextDueDate);
      equal(listed.installmentCount, detail.installmentCount);
      equal(listed.state, detail.state);
      equal(listed.chargeCount, detail.charges.filter((charge) => charge.state !== 'cancelled').length);
      equal(listed.paidCount, detail.charges.filter((charge) => charge.state === 'paid').length);
      equal(listed.participantCount, detail.allocations.filter((allocation) => allocation.kind === 'user').length);
      equal(listed.shareChargeId, detail.charges.find((charge) => charge.state === 'pending')!.id);
      equal(listed.proofsPending, 0);
    }
  });

  it('leaves proofs of cancelled charges out of the pending counter', async () => {
    const solo = (await contacts.save(OWNER, { name: 'Cancelado Solo', email: 'billing-cancelled-solo@example.com' })).userId;
    const created = await createBilling(
      db,
      OWNER,
      'cancelled-proof-key',
      once({
        description: 'Comprovante cancelado',
        totalCents: 3_000,
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: solo }] }
      })
    );
    const charge = created.charges[0]!;
    const instant = new Date().toISOString();
    const listed = async () => (await listBillings(db, OWNER, { search: 'comprovante cancelado' })).billings[0]!;

    await db.proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: charge.id },
        state: StoredProofState.Pending,
        kind: ProofKind.File,
        file: {
          key: `proofs/${created.id}/cancelled.pdf`,
          name: 'cancelado.pdf',
          mime: ProofMime.Pdf,
          size: 1_024,
          sha256: 'b'.repeat(64)
        },
        actor_hash: 'billings-spec-cancelled',
        sent_at: instant,
        created_at: instant,
        updated_at: instant
      }
    });

    equal((await listed()).proofsPending, 1);

    // A proof left pending on a cancelled charge asks for no review; the card must not badge it.
    await db.charges.updateOne({
      where: { id: charge.id },
      data: { state: ChargeState.Cancelled, cancelled_at: instant, updated_at: instant }
    });

    const cancelled = await listed();

    equal(cancelled.proofsPending, 0);
    equal(cancelled.chargeCount, 0);
  });

  it('keeps the quota column empty for splits that are not shares', async () => {
    const stray = {
      mode: 'equal',
      parts: [
        { kind: 'user', userId: debtorId, shares: 7 },
        { kind: 'owner', shares: 3 }
      ]
    } as unknown as BillingSplit;
    const created = await createBilling(db, OWNER, 'stray-shares-key', once({ description: 'Cotas indevidas', split: stray }));
    const rows = await db.allocations.findMany({ select: { value: true }, where: { billing_id: created.id } });

    // `equal` has no weight of its own, so the stray quota reaches no column at all.
    ok(rows.records.every((row) => row.value === null || row.value === undefined));
    deepEqual(
      (await getBilling(db, OWNER, created.id)).allocations.map((allocation) => allocation.shares),
      [undefined, undefined]
    );
  });

  it('lets a finite billing change its category even though the split stays frozen', async () => {
    const created = await createBilling(db, OWNER, 'category-patch-key', once({ description: 'Categoria editável' }));

    equal(created.category, 'other');

    const patched = await patchBilling(db, OWNER, created.id, { category: BillingCategory.Housing });

    equal(patched.category, 'housing');
    equal((await getBilling(db, OWNER, created.id)).category, 'housing');
    equal(
      (await listBillings(db, OWNER, { search: created.description })).billings.find((billing) => billing.id === created.id)?.category,
      'housing'
    );

    await rejects(() => patchBilling(db, OWNER, created.id, { category: BillingCategory.Loan, totalCents: 5_000 }), ApiError);
  });

  it('sorts contacts by their latest billing and always exposes lastBilledAt', async () => {
    const older = await contacts.save(OWNER, { name: 'Alfa Antiga', email: 'billing-recent-older@example.com' });
    const newer = await contacts.save(OWNER, { name: 'Zeta Recente', email: 'billing-recent-newer@example.com' });
    const never = await contacts.save(OWNER, { name: 'Bravo Sem Cobrança', email: 'billing-recent-never@example.com' });
    const forUser = (id: string) => once({ split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: id }] } });

    await createBilling(db, OWNER, 'recent-older-key', forUser(older.userId), date('2026-05-01'));
    await createBilling(db, OWNER, 'recent-newer-key', forUser(newer.userId), date('2026-06-01'));

    const recent = await ContactRepository.list(db, OWNER, undefined, false, '', 'recent');
    const ids = recent.contacts.map((contact) => contact.id);

    ok(ids.indexOf(newer.id) < ids.indexOf(older.id), 'the latest billed contact comes first');
    ok(ids.indexOf(older.id) < ids.indexOf(never.id), 'contacts without billings come last');
    equal(recent.nextCursor, null);
    equal(recent.contacts.find((contact) => contact.id === never.id)?.lastBilledAt, null);
    ok(recent.contacts.find((contact) => contact.id === newer.id)!.lastBilledAt!.startsWith('2026-06-01'));

    const alphabetical = await ContactRepository.list(db, OWNER);

    ok(alphabetical.contacts.find((contact) => contact.id === older.id)!.lastBilledAt!.startsWith('2026-05-01'));
    equal(alphabetical.contacts.find((contact) => contact.id === never.id)?.lastBilledAt, null);
    // A date-like term must stay a text parameter here too.
    equal((await ContactRepository.list(db, OWNER, undefined, false, '2026-10-31', 'recent')).contacts.length, 0);

    await contacts.archive(OWNER, never.id);

    const archived = await ContactRepository.list(db, OWNER, undefined, true, '', 'recent');

    ok(
      archived.contacts.some((contact) => contact.id === never.id),
      'the recent order honors the archived flag'
    );
    equal(
      archived.contacts.some((contact) => contact.id === newer.id),
      false
    );
    equal(
      (await ContactRepository.list(db, OWNER, undefined, false, '', 'recent')).contacts.some((contact) => contact.id === never.id),
      false
    );
  });

  it('lists only the materialized charges of an indefinite billing in the month, never future previews', async () => {
    const now = new Date();
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    const rule = await createBilling(
      db,
      OWNER,
      'preview-key',
      {
        ...once({ totalCents: 1_001 }),
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        startDate: local,
        reminders: [],
        split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: debtorId }, { kind: SplitPartKind.Owner }] }
      },
      now
    );

    // The occurrence due today is materialized at creation; later occurrences are not projected into the feed.
    equal(rule.charges.length, 1);
    equal(rule.charges[0]!.dueDate, local);

    const fromRule = (await monthCharges(db, OWNER, local.slice(0, 7))).filter((item) => item.billingId === rule.id);

    deepEqual(
      fromRule.map((item) => item.dueDate),
      [local]
    );
    equal(fromRule[0]?.billing.recurrence, BillingRecurrence.Indefinite);
    deepEqual(await materializeNextOccurrence(db, rule.id, now), {
      materialized: false,
      remaining: false,
      noticeChargeIds: []
    });

    await patchBilling(db, OWNER, rule.id, { state: BillingState.Ended });
  });

  it('round-trips a percentage split through Postgres and recomputes cents after totalCents changes', async () => {
    const split: BillingSplit = {
      mode: SplitMode.Percentage,
      parts: [
        { kind: SplitPartKind.User, userId: debtorId, basisPoints: 3333 },
        { kind: SplitPartKind.Owner, basisPoints: 6667 }
      ]
    };
    const created = await createBilling(db, OWNER, 'percentage-key', { ...once({ totalCents: 10_001 }), split });
    const persisted = (
      await db.allocations.findMany({
        select: { user_id: true, value: true },
        where: { billing_id: created.id },
        order: { sort_order: Order.Asc }
      })
    ).records;

    equal((await db.billings.findOne({ select: { split_mode: true }, where: { id: created.id } }))?.split_mode, 'percentage');
    // The owner's own part is the one carrying the owner id; nothing else tells the two sides apart.
    deepEqual(
      persisted.map((row) => [row.user_id === OWNER, row.value]),
      [
        [false, 3333],
        [true, 6667]
      ]
    );

    const fetched = await getBilling(db, OWNER, created.id);

    deepEqual(fetched.split, split);

    const resolved = resolveBillingSplit(10_001, split);
    const personCents = resolved.find((allocation) => allocation.kind === 'user')!.amountCents;

    equal(personCents, 3_333);
    deepEqual(
      created.charges.map((charge) => charge.amount.amountCents),
      [personCents]
    );

    const indefinite = await createBilling(
      db,
      OWNER,
      'percentage-indefinite-key',
      {
        ...once({ totalCents: 10_001 }),
        recurrence: BillingRecurrence.Indefinite,
        frequency: BillingFrequency.Monthly,
        startDate: '2026-01-31',
        split
      },
      date('2026-01-01')
    );

    // January materializes at creation now: one charge, for the split's only `user` part (the owner's
    // `percentage` part is absorbed, never billed), due on the start date itself.
    deepEqual(
      indefinite.charges.map((charge) => charge.dueDate),
      ['2026-01-31']
    );

    const patched = await patchBilling(db, OWNER, indefinite.id, { totalCents: 20_003 }, date('2026-01-01'));

    equal(patched.total.amountCents, 20_003);

    const reallocated = resolveBillingSplit(20_003, split);

    // The amounts are no longer a column: the response carries what resolveBillingSplit worked out.
    deepEqual(
      patched.allocations.map((allocation) => allocation.amount.amountCents),
      reallocated.map((allocation) => allocation.amountCents)
    );

    await patchBilling(db, OWNER, indefinite.id, { state: BillingState.Ended });
  });

  it('falls back a billing without reminders to the due-date default', async () => {
    const created = await createBilling(db, OWNER, 'no-reminders-key', once({ description: 'Sem lembretes próprios' }));

    deepEqual((await getBilling(db, OWNER, created.id)).reminders, DEFAULT_BILLING_REMINDERS);
  });
});
