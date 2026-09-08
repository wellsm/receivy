import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpConflictError, HttpNotFoundError } from '@ez4/gateway';
import type { RecurrenceInput } from '@receivy/common';
import { getCharge } from '../../src/charges/repository';
import { createExpense } from '../../src/expenses/repository';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { archivePerson, savePerson } from '../../src/people/repository';
import {
  createRecurrence,
  editRecurrence,
  getRecurrence,
  listRecurrences,
  materializeRecurrences,
  transitionRecurrence
} from '../../src/recurrences/repository';
import { recurrenceJobHandler } from '../../src/recurrences/scheduler';
import { getTimeline } from '../../src/timeline/repository';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'a4444444-1111-4111-8111-111111111111';
const OTHER = 'a4444444-2222-4222-8222-222222222222';
const date = (value: string) => new Date(`${value}T12:00:00Z`);
let input: RecurrenceInput;
describe('recurrences on native PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');
    equal(database?.['name'], 'receivy_tests');
    await createUser(db, { id: OWNER, email: 'recurrence@example.com', name: 'Dona' });
    await createUser(db, { id: OTHER, email: 'recurrence-other@example.com', name: 'Outra' });
    const person = await savePerson(db, OWNER, { name: 'Original', email: 'recurrence-debtor@example.com' });
    const pix = await savePaymentMethod(db, OWNER, { pixKeyType: 'cpf', pixKey: '52998224725', label: 'Original' });
    input = {
      description: 'Mensal',
      totalCents: 1001,
      frequency: 'monthly',
      day: 31,
      timezone: 'America/Sao_Paulo',
      startDate: '2026-01-01',
      paymentMethodId: pix.id,
      split: { mode: 'equal', parts: [{ kind: 'person', personId: person.id }, { kind: 'owner' }] }
    };
  });
  after(async () => cleanupUsers(db, [OWNER, OTHER]));
  it('returns the complete recurrence DTO backed by persisted safe-integer cents', async () => {
    const rule = await createRecurrence(db, OWNER, 'http-contract', { ...input, totalCents: 10001 }, date('2026-01-01'));
    equal((await db.recurrences.findOne({ select: { total_cents: true }, where: { id: rule.id } }))?.total_cents, 10001);
    const response = await getRecurrence(db, OWNER, rule.id);
    equal(response.totalCents, 10001);
    equal(response.frequency, 'monthly');
    equal(response.day, 31);
    equal(response.timezone, input.timezone);
    deepEqual(response.split, input.split);
    equal(response.paymentMethodId, input.paymentMethodId);
    await transitionRecurrence(db, OWNER, rule.id, 'ended');
  });
  it('binds create retries to body, enforces owner access and rejects newly backdated starts', async () => {
    const rule = await createRecurrence(db, OWNER, 'crud', input, date('2026-01-01'));
    equal((await createRecurrence(db, OWNER, 'crud', input, date('2026-03-01'))).id, rule.id);
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as RecurrenceInput;
    equal((await createRecurrence(db, OWNER, 'crud', reordered, date('2026-03-01'))).id, rule.id);
    await rejects(() => createRecurrence(db, OWNER, 'crud', { ...input, day: 15 }, date('2026-01-01')), HttpConflictError);
    await rejects(() => createRecurrence(db, OWNER, 'past', input, date('2026-02-01')), RangeError);
    await rejects(() => getRecurrence(db, OTHER, rule.id), HttpNotFoundError);
    await rejects(() => editRecurrence(db, OTHER, rule.id, input, date('2026-01-01')), HttpNotFoundError);
    await rejects(() => transitionRecurrence(db, OTHER, rule.id, 'paused'), HttpNotFoundError);
    await rejects(() => createRecurrence(db, OTHER, 'foreign', input, date('2026-01-01')), HttpNotFoundError);
    deepEqual(await listRecurrences(db, OTHER), []);
    await editRecurrence(db, OWNER, rule.id, { ...input, description: 'Editada' }, date('2026-02-01'));
    await rejects(() => editRecurrence(db, OWNER, rule.id, { ...input, startDate: '2026-01-02' }, date('2026-02-01')), RangeError);
    await transitionRecurrence(db, OWNER, rule.id, 'ended', date('2026-02-01'));
    await rejects(() => transitionRecurrence(db, OWNER, rule.id, 'active'), HttpConflictError);
  });
  it('serializes job replay with expense creation and preserves all snapshots and one initial outbox', async () => {
    const rule = await createRecurrence(db, OWNER, 'concurrent', input, date('2026-01-01'));
    await Promise.all([
      materializeRecurrences(db, date('2026-01-28')),
      materializeRecurrences(db, date('2026-01-28')),
      createExpense(db, OWNER, 'parallel-expense', { ...input, installmentCount: 1, firstDueDate: '2026-01-31' })
    ]);
    equal(await db.recurrence_occurrences.count({ where: { recurrence_id: rule.id } }), 1);
    const charges = await db.charges.findMany({ select: { id: true }, where: { source_id: rule.id } });
    equal(charges.records.length, 1);
    const id = charges.records[0]!.id;
    equal(await db.outbox_events.count({ where: { aggregate_id: id, type: 'charge.created' } }), 1);
    await editRecurrence(db, OWNER, rule.id, { ...input, description: 'Futura', day: 30, totalCents: 2000 }, date('2026-01-28'));
    const personId = input.split.parts.find((p) => p.kind === 'person')!;
    if (personId.kind !== 'person') throw new Error('Missing fixture recipient');
    await savePerson(db, OWNER, { name: 'Editado', email: 'recurrence-other@example.com' }, personId.personId);
    await savePaymentMethod(
      db,
      OWNER,
      { pixKeyType: 'random', pixKey: '11111111-1111-4111-8111-111111111111', label: 'Editada' },
      input.paymentMethodId
    );
    await materializeRecurrences(db, date('2026-01-28'));
    equal(
      await db.recurrence_occurrences.count({ where: { recurrence_id: rule.id } }),
      2,
      'future edit must not skip nearer unmaterialized date behind the previous cursor'
    );
    const rereviewed = await editRecurrence(db, OWNER, rule.id, { ...input, description: 'Revisada', day: 30 }, date('2026-01-28'));
    equal(rereviewed.nextMaterialization, '2026-02-25', 'next materialization must skip persisted occurrences after a cursor rewind');
    const snapshot = await getCharge(db, OWNER, id);
    equal(snapshot.description, 'Mensal');
    equal(snapshot.amount.amountCents, 501);
    equal(snapshot.dueDate, '2026-01-31');
    equal(snapshot.pix?.key, '52998224725');
    equal(snapshot.recipient.name, 'Original');
    await rejects(() => getCharge(db, OTHER, id));
    await savePerson(db, OWNER, { name: 'Original', email: 'recurrence-debtor@example.com' }, personId.personId);
    await savePaymentMethod(db, OWNER, { pixKeyType: 'cpf', pixKey: '52998224725', label: 'Original' }, input.paymentMethodId);
    const occurrence = await db.recurrence_occurrences.findOne({
      select: { id: true, reminders_json: true },
      where: { recurrence_id: rule.id, occurrence_date: '2026-01-31' }
    });
    ok(occurrence);
    equal(JSON.parse(occurrence.reminders_json).length, 3);
    equal(await db.outbox_events.count({ where: { aggregate_id: occurrence.id, type: 'recurrence.materialized' } }), 1);
    equal(await db.activity_events.count({ where: { aggregate_id: occurrence.id, type: 'recurrence.materialized' } }), 1);
    await rejects(() =>
      db.recurrence_occurrences.insertOne({
        data: {
          id: crypto.randomUUID(),
          recurrence: { id: rule.id },
          occurrence_date: '2026-01-31',
          materialized_at: date('2026-01-28').toISOString(),
          reminders_json: '[]',
          timezone: input.timezone
        }
      })
    );
    await transitionRecurrence(db, OWNER, rule.id, 'ended');
  });
  it('clears optional end, month and Pix fields on future edits', async () => {
    const rule = await createRecurrence(
      db,
      OWNER,
      'clear-options',
      { ...input, frequency: 'yearly', month: 2, day: 29, endDate: '2027-12-31' },
      date('2026-01-01')
    );
    const edited = await editRecurrence(db, OWNER, rule.id, { ...input, paymentMethodId: undefined }, date('2026-01-01'));
    equal(edited.endDate, undefined);
    equal(edited.month, undefined);
    equal(edited.paymentMethodId, undefined);
    await transitionRecurrence(db, OWNER, rule.id, 'ended');
  });
  it('rolls back unavailable recipient materialization without starving another active rule', async () => {
    const person = await savePerson(db, OWNER, { name: 'Arquivado depois' });
    const invalid = await createRecurrence(
      db,
      OWNER,
      'unavailable',
      { ...input, day: 15, split: { mode: 'equal', parts: [{ kind: 'person', personId: person.id }] } },
      date('2026-01-01')
    );
    const valid = await createRecurrence(db, OWNER, 'available', { ...input, day: 15 }, date('2026-01-01'));
    await archivePerson(db, OWNER, person.id);
    const result = await materializeRecurrences(db, date('2026-01-15'));
    deepEqual(result.failures, [invalid.id]);
    equal(result.materialized, 1);
    equal(await db.recurrence_occurrences.count({ where: { recurrence_id: invalid.id } }), 0);
    equal(await db.charges.count({ where: { source_id: invalid.id } }), 0);
    equal(
      (await db.recurrences.findOne({ select: { processed_through: true }, where: { id: invalid.id } }))?.processed_through,
      '2025-12-31'
    );
    await transitionRecurrence(db, OWNER, invalid.id, 'ended');
    await transitionRecurrence(db, OWNER, valid.id, 'ended');
  });
  it('does not overwrite newer financial progress when an older failure marker resumes', async () => {
    const person = await savePerson(db, OWNER, { name: 'Corrigido durante retry' });
    const rule = await createRecurrence(
      db,
      OWNER,
      'interleaved-failure',
      { ...input, day: 15, split: { mode: 'equal', parts: [{ kind: 'person', personId: person.id }] } },
      date('2026-01-01')
    );
    await archivePerson(db, OWNER, person.id);
    let release!: () => void;
    let reached!: () => void;
    let transactions = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const markerReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    // Pause only the older invocation between financial rollback and marker lock.
    // Both invocations still execute every transaction against real PostgreSQL.
    const olderDb = new Proxy(db, {
      get(target, key) {
        if (key === 'transaction')
          return async (operation: Parameters<typeof db.transaction>[0]) => {
            if (++transactions === 2) {
              reached();
              await gate;
            }
            return target.transaction(operation);
          };
        return Reflect.get(target, key);
      }
    });
    const older = materializeRecurrences(olderDb, date('2026-01-15'));
    await markerReached;
    try {
      await editRecurrence(db, OWNER, rule.id, { ...input, day: 15 }, date('2026-01-01'));
      equal((await materializeRecurrences(db, date('2026-01-16'))).materialized, 1);
    } finally {
      release();
    }
    deepEqual((await older).failures, [rule.id]);
    const row = await db.recurrences.findOne({ select: { processed_through: true, last_attempted_at: true }, where: { id: rule.id } });
    equal(row?.processed_through, '2026-01-15');
    equal(row?.last_attempted_at, date('2026-01-16').toISOString());
    equal(await db.recurrence_occurrences.count({ where: { recurrence_id: rule.id } }), 1);
    await transitionRecurrence(db, OWNER, rule.id, 'ended');
  });
  it('caps failed due attempts globally and rotates fairly to healthy backlog on the next run', async () => {
    const person = await savePerson(db, OWNER, { name: 'Indisponível em lote' });
    const invalidIds: string[] = [];
    for (let index = 0; index < 101; index++) {
      const rule = await createRecurrence(
        db,
        OWNER,
        `failed-budget-${index}`,
        { ...input, day: 15, split: { mode: 'equal', parts: [{ kind: 'person', personId: person.id }] } },
        date('2026-01-01')
      );
      invalidIds.push(rule.id);
    }
    const healthy = await createRecurrence(db, OWNER, 'healthy-budget', { ...input, day: 15 }, date('2026-01-01'));
    // Deterministic ordering: all 101 never-attempted rules precede healthy work.
    await db.recurrences.updateOne({ where: { id: healthy.id }, data: { last_attempted_at: date('2026-01-01').toISOString() } });
    await archivePerson(db, OWNER, person.id);
    const first = await materializeRecurrences(db, date('2026-02-15'));
    equal(first.materialized, 0);
    equal(first.failures.length, 100);
    ok(first.failures.length <= 100, 'rolled-back due attempts consume the global 100-attempt budget');
    ok(first.failures.length + first.materialized <= 100);
    const second = await materializeRecurrences(db, date('2026-02-16'));
    ok(second.failures.length + second.materialized <= 100);
    ok(
      (await db.recurrence_occurrences.count({ where: { recurrence_id: healthy.id } })) > 0,
      'healthy work progresses across runs despite more than 100 failing rules'
    );
    const attemptedId = first.failures[0]!;
    await db.recurrences.updateOne({ where: { id: attemptedId }, data: { last_attempted_at: date('2026-03-01').toISOString() } });
    for (const id of invalidIds) {
      equal((await db.recurrences.findOne({ select: { processed_through: true }, where: { id } }))?.processed_through, '2025-12-31');
      if (id !== attemptedId) await transitionRecurrence(db, OWNER, id, 'ended');
    }
    await transitionRecurrence(db, OWNER, healthy.id, 'ended');
    await materializeRecurrences(db, date('2026-02-17'));
    equal(
      (await db.recurrences.findOne({ select: { last_attempted_at: true }, where: { id: attemptedId } }))?.last_attempted_at,
      date('2026-03-01').toISOString(),
      'late older failure marking must preserve newer metadata'
    );
    await transitionRecurrence(db, OWNER, attemptedId, 'ended');
  });
  it('skips paused historical debt but catches up continuously active outages in bounded batches', async () => {
    const paused = await createRecurrence(db, OWNER, 'paused', { ...input, reminders: [] }, date('2026-01-01'));
    await transitionRecurrence(db, OWNER, paused.id, 'paused', date('2026-01-15'));
    await materializeRecurrences(db, date('2026-03-31'));
    equal(await db.charges.count({ where: { source_id: paused.id } }), 0);
    await transitionRecurrence(db, OWNER, paused.id, 'active', date('2026-04-01'));
    await materializeRecurrences(db, date('2026-04-30'));
    const occurrences = await db.recurrence_occurrences.findMany({
      select: { occurrence_date: true },
      where: { recurrence_id: paused.id }
    });
    deepEqual(
      occurrences.records.map((r) => r.occurrence_date),
      ['2026-04-30']
    );
    await transitionRecurrence(db, OWNER, paused.id, 'ended');
    const backlog = await createRecurrence(db, OWNER, 'backlog', { ...input, startDate: '2000-01-01', reminders: [] }, date('2000-01-01'));
    equal((await materializeRecurrences(db, date('2010-01-31'))).materialized, 100);
    equal((await materializeRecurrences(db, date('2010-01-31'))).materialized, 21);
    equal(await db.recurrence_occurrences.count({ where: { recurrence_id: backlog.id } }), 121);
    await transitionRecurrence(db, OWNER, backlog.id, 'ended');
  });
  it('projects owner-only virtual entries without amounts in balances or duplication after materialization', async () => {
    const now = new Date();
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }).format(now);
    const rule = await createRecurrence(
      db,
      OWNER,
      'preview',
      { ...input, startDate: local, day: Number(local.slice(8)), reminders: [] },
      now
    );
    ok(rule.previews.length > 0);
    ok(rule.previews.length <= 4);
    const before = await getTimeline(db, OWNER, { source: 'recurrence', from: local });
    ok(before.items.some((i) => i.kind === 'recurrence_preview' && i.preview.recurrenceId === rule.id));
    await recurrenceJobHandler({ requestId: 'native-hourly-test', event: null }, { db });
    await recurrenceJobHandler({ requestId: 'native-hourly-replay', event: null }, { db });
    const after = await getTimeline(db, OWNER, { source: 'recurrence', from: local });
    equal(after.summary.receivable.amountCents - before.summary.receivable.amountCents, 501);
    equal(
      after.items.some((i) => i.kind === 'recurrence_preview' && i.preview.recurrenceId === rule.id && i.preview.occurrenceDate === local),
      false
    );
    equal(
      (await getTimeline(db, OTHER, {})).items.some((i) => i.kind === 'recurrence_preview'),
      false
    );
    await transitionRecurrence(db, OWNER, rule.id, 'ended');
  });
});
