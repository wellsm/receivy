import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import type { BillingInput } from '@receivy/common';
import { DEFAULT_BILLING_REMINDERS, resolveBillingSplit } from '@receivy/common';
import { createBilling, getBilling, listBillings, materializeBillings, patchBilling, previewBilling } from '../../src/billings/repository';
import { getCharge } from '../../src/charges/repository';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { archivePerson, listPeople, savePerson } from '../../src/people/repository';
import { getTimeline } from '../../src/timeline/repository';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'b1111111-1111-4111-8111-111111111111';
const OTHER = 'b2222222-2222-4222-8222-222222222222';
const date = (value: string) => new Date(`${value}T12:00:00Z`);

let personId: string;
let pixId: string;
let sharesId: string;

function once(overrides: Partial<BillingInput> = {}): BillingInput {
  return {
    type: 'once',
    description: 'Jantar',
    totalCents: 9_000,
    startDate: '2026-10-31',
    timezone: 'America/Sao_Paulo',
    paymentMethodId: pixId,
    split: { mode: 'fixed', parts: [{ kind: 'person', personId, amountCents: 6_001 }] },
    ...overrides
  };
}

describe('billings on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');
    equal(database?.['name'], 'receivy_tests');
    await createUser(db, { id: OWNER, email: 'billing-owner@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'billing-other@example.com', name: 'Outra' });
    personId = (await savePerson(db, OWNER, { name: 'Bruno', email: 'billing-debtor@example.com' })).id;
    pixId = (await savePaymentMethod(db, OWNER, { pixKeyType: 'cpf', pixKey: '52998224725', label: 'Principal' })).id;
  });

  after(async () => cleanupUsers(db, [OWNER, OTHER]));

  it('creates a once billing with one numbered charge, immutable snapshots and idempotent replay', async () => {
    const created = await createBilling(db, OWNER, 'once-key', once());
    equal(created.type, 'once');
    equal(created.installmentCount, 1);
    deepEqual(
      created.charges.map((charge) => [charge.amount.amountCents, charge.installment, charge.installmentCount]),
      [[6_001, 1, 1]]
    );
    equal(created.charges[0]!.billingType, 'once');
    equal((await createBilling(db, OWNER, 'once-key', once())).id, created.id);
    await rejects(() => createBilling(db, OWNER, 'once-key', once({ totalCents: 9_001 })), HttpConflictError);
    await rejects(() => getBilling(db, OTHER, created.id), HttpNotFoundError);
    await savePerson(db, OWNER, { name: 'Bruno Editado', email: 'billing-other@example.com' }, personId);
    const snapshot = await getCharge(db, OWNER, created.charges[0]!.id);
    deepEqual(snapshot.recipient, { name: 'Bruno', email: 'billing-debtor@example.com' });
    equal(snapshot.pix?.key, '52998224725');
    await savePerson(db, OWNER, { name: 'Bruno', email: 'billing-debtor@example.com' }, personId);
    equal(await db.outbox_events.count({ where: { aggregate_id: created.charges[0]!.id, type: 'charge.created' } }), 1);
  });

  it('creates every occurrence of an until billing at once with exact per-occurrence cents and clamped days', async () => {
    const created = await createBilling(db, OWNER, 'until-key', {
      ...once({ description: 'Aluguel', totalCents: 1_001 }),
      type: 'until',
      frequency: 'monthly',
      startDate: '2026-01-31',
      endDate: '2026-03-31',
      split: { mode: 'equal', parts: [{ kind: 'person', personId }, { kind: 'owner' }] }
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
          type: 'until',
          frequency: 'monthly',
          startDate: '2026-01-01',
          endDate: '2040-01-01'
        }),
      RangeError
    );
    await rejects(
      () =>
        createBilling(db, OWNER, 'until-backwards', {
          ...once(),
          type: 'until',
          frequency: 'monthly',
          startDate: '2026-03-01',
          endDate: '2026-01-01'
        }),
      RangeError
    );
    await rejects(() => patchBilling(db, OWNER, created.id, { totalCents: 2_000 }), HttpConflictError);
    const ended = await patchBilling(db, OWNER, created.id, { state: 'ended' });
    equal(ended.state, 'ended');
    deepEqual(
      ended.charges.map((charge) => charge.state),
      ['cancelled', 'cancelled', 'cancelled']
    );
    await rejects(() => patchBilling(db, OWNER, created.id, { reminders: [] }), HttpConflictError);
  });

  it('materializes indefinite billings one occurrence at a time without duplicates and honors pause', async () => {
    const created = await createBilling(
      db,
      OWNER,
      'indefinite-key',
      {
        ...once({ description: 'Mensal', totalCents: 1_001 }),
        type: 'indefinite',
        frequency: 'monthly',
        startDate: '2026-01-31',
        split: { mode: 'equal', parts: [{ kind: 'person', personId }, { kind: 'owner' }] }
      },
      date('2026-01-01')
    );
    equal(created.charges.length, 0);
    ok(created.previews.length > 0);
    equal(created.nextMaterialization, '2026-01-31');
    await rejects(
      () =>
        createBilling(
          db,
          OWNER,
          'indefinite-past',
          { ...once(), type: 'indefinite', frequency: 'monthly', startDate: '2025-01-01' },
          date('2026-01-01')
        ),
      RangeError
    );
    await Promise.all([materializeBillings(db, date('2026-01-31')), materializeBillings(db, date('2026-01-31'))]);
    const charges = await db.charges.findMany({ select: { due_date: true, installment: true }, where: { billing_id: created.id } });
    equal(charges.records.length, 1);
    equal(charges.records[0]!.due_date, '2026-01-31');
    ok(charges.records[0]!.installment == null);
    const paused = await patchBilling(db, OWNER, created.id, { state: 'paused' }, date('2026-02-01'));
    equal(paused.state, 'paused');
    await materializeBillings(db, date('2026-03-31'));
    equal(await db.charges.count({ where: { billing_id: created.id } }), 1);
    await patchBilling(db, OWNER, created.id, { state: 'active' }, date('2026-04-01'));
    await materializeBillings(db, date('2026-04-30'));
    deepEqual(
      (
        await db.charges.findMany({ select: { due_date: true }, where: { billing_id: created.id }, order: { due_date: Order.Asc } })
      ).records.map((row) => row.due_date),
      ['2026-01-31', '2026-04-30']
    );
    const oncePreviewId = (await createBilling(db, OWNER, 'once-preview', once())).id;

    await rejects(() => previewBilling(db, OWNER, oncePreviewId), HttpConflictError);
    await patchBilling(db, OWNER, created.id, { state: 'ended' });
  });

  it('edits future occurrences of an indefinite billing and rolls back unavailable recipients without starving others', async () => {
    const archived = await savePerson(db, OWNER, { name: 'Arquivado' });
    const invalid = await createBilling(
      db,
      OWNER,
      'invalid-key',
      {
        ...once(),
        type: 'indefinite',
        frequency: 'monthly',
        startDate: '2026-01-15',
        split: { mode: 'equal', parts: [{ kind: 'person', personId: archived.id }] }
      },
      date('2026-01-01')
    );
    const valid = await createBilling(
      db,
      OWNER,
      'valid-key',
      {
        ...once({ totalCents: 2_000 }),
        type: 'indefinite',
        frequency: 'monthly',
        startDate: '2026-01-15',
        split: { mode: 'equal', parts: [{ kind: 'person', personId }] }
      },
      date('2026-01-01')
    );
    await archivePerson(db, OWNER, archived.id);
    const result = await materializeBillings(db, date('2026-01-15'));
    deepEqual(result.failures, [invalid.id]);
    equal(result.materialized, 1);
    equal((await db.billings.findOne({ select: { processed_through: true }, where: { id: invalid.id } }))?.processed_through, '2025-12-31');
    const edited = await patchBilling(
      db,
      OWNER,
      valid.id,
      { description: 'Editada', totalCents: 3_000, reminders: [{ offsetDays: -5, enabled: true }] },
      date('2026-01-16')
    );
    equal(edited.description, 'Editada');
    deepEqual(edited.reminders, [{ offsetDays: -5, enabled: true }]);
    equal((await getCharge(db, OWNER, edited.charges[0]!.id)).amount.amountCents, 2_000, 'materialized charges stay snapshots');
    await patchBilling(db, OWNER, invalid.id, { state: 'ended' });
    await patchBilling(db, OWNER, valid.id, { state: 'ended' });
  });

  it('lists the owner billings newest first with cursor and type filter', async () => {
    const page = await listBillings(db, OWNER, { type: 'once' });
    ok(page.billings.length >= 2);
    ok(page.billings.every((billing) => billing.type === 'once'));
    deepEqual(await listBillings(db, OTHER), { billings: [], nextCursor: null });
  });

  it('persists a category and a shares split with one charge per quota', async () => {
    const [second, third, fourth] = await Promise.all([
      savePerson(db, OWNER, { name: 'Cota Dois' }),
      savePerson(db, OWNER, { name: 'Cota Tres' }),
      savePerson(db, OWNER, { name: 'Cota Quatro' })
    ]);
    const split = {
      mode: 'shares' as const,
      parts: [
        { kind: 'person' as const, personId, shares: 2 },
        { kind: 'person' as const, personId: second!.id, shares: 2 },
        { kind: 'person' as const, personId: third!.id, shares: 1 },
        { kind: 'person' as const, personId: fourth!.id, shares: 1 }
      ]
    };
    const created = await createBilling(
      db,
      OWNER,
      'shares-key',
      once({ description: 'Churrasco do sábado', totalCents: 12_000, category: 'food', split })
    );

    sharesId = created.id;
    equal(created.category, 'food');
    deepEqual(
      created.charges.map((charge) => charge.amount.amountCents).sort((left, right) => left - right),
      [2_000, 2_000, 4_000, 4_000]
    );
    deepEqual(
      (
        await db.allocations.findMany({
          select: { split_mode: true, shares: true },
          where: { billing_id: created.id },
          order: { allocation_order: Order.Asc }
        })
      ).records.map((row) => [row.split_mode, row.shares]),
      [
        ['shares', 2],
        ['shares', 2],
        ['shares', 1],
        ['shares', 1]
      ]
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
        createBilling(db, OWNER, 'shares-key', once({ description: 'Churrasco do sábado', totalCents: 12_000, category: 'travel', split })),
      HttpConflictError
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

    await db.charges.updateOne({ where: { id: charges.records[0]!.id }, data: { state: 'paid', paid_at: instant, updated_at: instant } });
    await db.payment_proofs.insertOne({
      data: {
        id: crypto.randomUUID(),
        charge: { id: charges.records[1]!.id },
        object_key: `proofs/${sharesId}/counter.pdf`,
        original_name: 'counter.pdf',
        mime: 'application/pdf',
        size: 1_024,
        sha256: 'a'.repeat(64),
        state: 'pending',
        created_at: instant
      }
    });

    const after = await summaryOf(sharesId);

    equal(after.paidCount, 1);
    equal(after.proofsPending, 1);
    equal(after.chargeCount, 4);

    const single = await createBilling(db, OWNER, 'share-single-key', once({ description: 'Cobrança sozinha', category: 'travel' }));

    equal((await summaryOf(single.id)).shareChargeId, single.charges[0]!.id);
    equal((await summaryOf(single.id)).participantCount, 1);
  });

  it('searches billings by description and filters them by category', async () => {
    deepEqual(
      (await listBillings(db, OWNER, { search: '  CHURRasco  ' })).billings.map((billing) => billing.id),
      [sharesId]
    );
    equal((await listBillings(db, OWNER, { search: 'churrasco do sábado' })).billings.length, 1);
    equal((await listBillings(db, OWNER, { search: 'nada-que-exista' })).billings.length, 0);
    equal((await listBillings(db, OTHER, { search: 'churr' })).billings.length, 0);

    const food = await listBillings(db, OWNER, { category: 'food' });

    ok(food.billings.some((billing) => billing.id === sharesId));
    ok(food.billings.every((billing) => billing.category === 'food'));
    equal((await listBillings(db, OWNER, { search: 'churr', category: 'travel' })).billings.length, 0);
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

  it('lets a finite billing change its category even though the split stays frozen', async () => {
    const created = await createBilling(db, OWNER, 'category-patch-key', once({ description: 'Categoria editável' }));

    equal(created.category, 'other');

    const patched = await patchBilling(db, OWNER, created.id, { category: 'housing' });

    equal(patched.category, 'housing');
    equal((await getBilling(db, OWNER, created.id)).category, 'housing');
    ok((await listBillings(db, OWNER, { category: 'housing' })).billings.some((billing) => billing.id === created.id));
    await rejects(() => patchBilling(db, OWNER, created.id, { category: 'loan', totalCents: 5_000 }), HttpConflictError);
  });

  it('sorts contacts by their latest billing and always exposes lastBilledAt', async () => {
    const older = await savePerson(db, OWNER, { name: 'Alfa Antiga' });
    const newer = await savePerson(db, OWNER, { name: 'Zeta Recente' });
    const never = await savePerson(db, OWNER, { name: 'Bravo Sem Cobrança' });
    const forPerson = (id: string) => once({ split: { mode: 'equal', parts: [{ kind: 'person', personId: id }] } });

    await createBilling(db, OWNER, 'recent-older-key', forPerson(older.id), date('2026-05-01'));
    await createBilling(db, OWNER, 'recent-newer-key', forPerson(newer.id), date('2026-06-01'));

    const recent = await listPeople(db, OWNER, undefined, false, '', 'recent');
    const ids = recent.people.map((person) => person.id);

    ok(ids.indexOf(newer.id) < ids.indexOf(older.id), 'the latest billed contact comes first');
    ok(ids.indexOf(older.id) < ids.indexOf(never.id), 'contacts without billings come last');
    equal(recent.nextCursor, null);
    equal(recent.people.find((person) => person.id === never.id)?.lastBilledAt, null);
    ok(recent.people.find((person) => person.id === newer.id)!.lastBilledAt!.startsWith('2026-06-01'));

    const alphabetical = await listPeople(db, OWNER);

    ok(alphabetical.people.find((person) => person.id === older.id)!.lastBilledAt!.startsWith('2026-05-01'));
    equal(alphabetical.people.find((person) => person.id === never.id)?.lastBilledAt, null);
  });

  it('projects indefinite previews in the timeline and removes them after materialization', async () => {
    const now = new Date();
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    const rule = await createBilling(
      db,
      OWNER,
      'preview-key',
      {
        ...once({ totalCents: 1_001 }),
        type: 'indefinite',
        frequency: 'monthly',
        startDate: local,
        reminders: [],
        split: { mode: 'equal', parts: [{ kind: 'person', personId }, { kind: 'owner' }] }
      },
      now
    );
    const before = await getTimeline(db, OWNER, { type: 'indefinite', from: local });
    ok(before.items.some((item) => item.kind === 'billing_preview' && item.preview.billingId === rule.id));
    await materializeBillings(db, now);
    const after = await getTimeline(db, OWNER, { type: 'indefinite', from: local });
    equal(after.summary.receivable.amountCents - before.summary.receivable.amountCents, 501);
    equal(
      after.items.some(
        (item) => item.kind === 'billing_preview' && item.preview.billingId === rule.id && item.preview.occurrenceDate === local
      ),
      false
    );
    await patchBilling(db, OWNER, rule.id, { state: 'ended' });
  });

  it('round-trips a percentage split through Postgres and recomputes cents after totalCents changes', async () => {
    const split = {
      mode: 'percentage' as const,
      parts: [
        { kind: 'person' as const, personId, basisPoints: 3333 },
        { kind: 'owner' as const, basisPoints: 6667 }
      ]
    };
    const created = await createBilling(db, OWNER, 'percentage-key', { ...once({ totalCents: 10_001 }), split });
    const persisted = (
      await db.allocations.findMany({
        select: { kind: true, split_mode: true, basis_points: true },
        where: { billing_id: created.id },
        order: { allocation_order: Order.Asc }
      })
    ).records;
    deepEqual(
      persisted.map((row) => [row.kind, row.split_mode, row.basis_points]),
      [
        ['person', 'percentage', 3333],
        ['owner', 'percentage', 6667]
      ]
    );

    const fetched = await getBilling(db, OWNER, created.id);
    deepEqual(fetched.split, split);

    const resolved = resolveBillingSplit(10_001, split);
    const personCents = resolved.find((allocation) => allocation.kind === 'person')!.amountCents;
    equal(personCents, 3_333);
    deepEqual(
      created.charges.map((charge) => charge.amount.amountCents),
      [personCents]
    );

    const indefinite = await createBilling(
      db,
      OWNER,
      'percentage-indefinite-key',
      { ...once({ totalCents: 10_001 }), type: 'indefinite', frequency: 'monthly', startDate: '2026-01-31', split },
      date('2026-01-01')
    );
    const patched = await patchBilling(db, OWNER, indefinite.id, { totalCents: 20_003 }, date('2026-01-01'));
    equal(patched.total.amountCents, 20_003);
    const reallocated = resolveBillingSplit(20_003, split);
    const reallocatedRows = (
      await db.allocations.findMany({
        select: { amount_cents: true },
        where: { billing_id: indefinite.id },
        order: { allocation_order: Order.Asc }
      })
    ).records;
    deepEqual(
      reallocatedRows.map((row) => row.amount_cents),
      reallocated.map((allocation) => allocation.amountCents)
    );

    await patchBilling(db, OWNER, indefinite.id, { state: 'ended' });
  });

  it('falls back a billing without reminders to the due-date default', async () => {
    const created = await createBilling(db, OWNER, 'no-reminders-key', once({ description: 'Sem lembretes próprios' }));
    deepEqual((await getBilling(db, OWNER, created.id)).reminders, DEFAULT_BILLING_REMINDERS);
  });
});
