import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { BillingFrequency, type BillingSplit, BillingState, BillingType, PixKeyType, SplitMode, SplitPartKind } from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { instantAt, REMINDER_HOUR } from '../../src/notifications/services/planner';
import { type ChargeNotifyEvent, notifyIdentifier, planReminders } from '../../src/notifications/services/send';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';
import { fakeNotice, fakeScheduler } from '../fixtures/scheduling';

const OWNER = 'b5555555-5555-4555-8555-555555555555';
const DEBTOR_EMAIL = 'daily-cron-debtor@example.com';
const TZ = 'America/Sao_Paulo';

const date = (value: string) => new Date(`${value}T12:00:00Z`);

/** 05:00 UTC is when the daily cron runs: 02:00 in São Paulo, so the day has already turned there. */
const cronAt = (day: string) => new Date(`${day}T05:00:00Z`);

/** Reminders reach people at 06:00 of the billing timezone. */
const reminderAt = (day: string) => instantAt(day, REMINDER_HOUR, TZ);

const { context, sent, notify } = fakeNotice();

async function charges(billingId: string): Promise<{ id: string; due_date: string }[]> {
  const found = await db.charges.findMany({
    select: { id: true, due_date: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return found.records;
}

async function dueDates(billingId: string): Promise<string[]> {
  return (await charges(billingId)).map((row) => row.due_date);
}

async function cursorOf(billingId: string): Promise<string | undefined> {
  const row = await db.billings.findOne({ select: { processed_through: true }, where: { id: billingId } });

  return row?.processed_through;
}

async function auditTypes(billingId: string): Promise<string[]> {
  return (await EventRepository.list(db, billingId)).map((event) => event.type);
}

/** The sweep announces every assinatura in the database, so only the mails of this spec's debtor count. */
const debtorEmails = () => sent.emails.filter((email) => email.to === DEBTOR_EMAIL);

/** Fresh scheduler per plan, so what the plan armed is exactly what the fake holds. */
async function plan(now: Date) {
  const scheduler = fakeScheduler<ChargeNotifyEvent>();
  const planned = await planReminders(db, scheduler, now.getTime());

  equal(planned, scheduler.events.size, 'one schedule per charge, one count per schedule');

  return scheduler.events;
}

let debtorId: string;
let pixId: string;
let monthlyId: string;
let earlyId: string;

function monthly(key: string, startDate: string, overrides: Record<string, unknown> = {}) {
  return {
    type: BillingType.Indefinite as const,
    frequency: BillingFrequency.Monthly as const,
    description: key,
    totalCents: 4_000,
    startDate,
    timezone: TZ,
    paymentMethodId: pixId,
    split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: debtorId, amountCents: 4_000 }] } satisfies BillingSplit,
    ...overrides
  };
}

describe('daily cron: materialization and reminder plan', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'daily-cron-owner@example.com', name: 'Dona' });

    debtorId = (await ContactRepository.save(db, OWNER, { name: 'Bruno', email: DEBTOR_EMAIL })).userId;
    pixId = (await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Cpf, pixKey: '52998224725', label: 'Principal' })).id;
    monthlyId = (
      await BillingRepository.create(
        db,
        OWNER,
        'cron-monthly',
        monthly('Mensalidade', '2026-01-31'),
        date('2026-01-01'),
        undefined,
        context
      )
    ).id;
    earlyId = (
      await BillingRepository.create(
        db,
        OWNER,
        'cron-early',
        monthly('Antecipada', '2026-06-30', {
          reminders: [
            { offsetDays: -5, enabled: true },
            { offsetDays: 0, enabled: false }
          ]
        }),
        date('2026-01-01'),
        undefined,
        context
      )
    ).id;

    deepEqual(await dueDates(monthlyId), [], 'nothing is due at creation');
    deepEqual(await dueDates(earlyId), []);
  });

  after(async () => cleanupUsers(db, [OWNER]));

  it('materializes every due occurrence of every active assinatura and announces the charges once', async () => {
    sent.reset();

    ok((await BillingRepository.materializeDueBillings(db, context, cronAt('2026-03-05'))) >= 1);
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28']);
    equal(await cursorOf(monthlyId), '2026-02-28');
    equal((await auditTypes(monthlyId)).filter((type) => type === 'billing.materialized').length, 2);
    deepEqual(await dueDates(earlyId), [], 'June is not due in March');

    equal(debtorEmails().length, 2, 'each new charge says hello once');

    for (const { id } of await charges(monthlyId)) {
      deepEqual((await EventRepository.list(db, id, 'notice.sent'))[0]?.payload, { template: 'initial', channels: ['email'] });
      equal(notify.events.has(notifyIdentifier(id)), false, 'an e-mail sent right away needs no follow-up');
    }

    // Both steps are idempotent: the same day again finds nothing to do.
    sent.reset();
    deepEqual(await BillingRepository.materializeDue(db, monthlyId, context, cronAt('2026-03-05')), { materialized: false });
    await BillingRepository.materializeDueBillings(db, context, cronAt('2026-03-05'));
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28']);
    equal(debtorEmails().length, 0);
  });

  it('skips paused, ended and finite billings, and materializes inline when one resumes', async () => {
    sent.reset();

    const paused = await BillingRepository.create(
      db,
      OWNER,
      'cron-paused',
      monthly('Pausada', '2026-02-15'),
      date('2026-01-01'),
      undefined,
      context
    );
    const ended = await BillingRepository.create(
      db,
      OWNER,
      'cron-ended',
      monthly('Encerrada', '2026-02-15'),
      date('2026-01-01'),
      undefined,
      context
    );
    const once = await BillingRepository.create(
      db,
      OWNER,
      'cron-once',
      { ...monthly('Única', '2026-02-15'), type: BillingType.Once, frequency: undefined },
      date('2026-01-01'),
      undefined,
      context
    );

    equal(once.charges.length, 1, 'a finite billing has every charge from day one');

    await BillingRepository.patch(db, OWNER, paused.id, { state: BillingState.Paused }, date('2026-01-02'), undefined, context);
    await BillingRepository.patch(db, OWNER, ended.id, { state: BillingState.Ended }, date('2026-01-02'), undefined, context);
    sent.reset();

    await BillingRepository.materializeDueBillings(db, context, cronAt('2026-03-05'));
    deepEqual(await dueDates(paused.id), [], 'a paused billing generates nothing');
    deepEqual(await dueDates(ended.id), []);
    deepEqual(await dueDates(once.id), ['2026-02-15']);
    equal(debtorEmails().length, 0);

    // Resuming owes the occurrence of the day right away, without waiting for the next sweep.
    await BillingRepository.patch(db, OWNER, paused.id, { state: BillingState.Active }, date('2026-04-15'), undefined, context);
    deepEqual(await dueDates(paused.id), ['2026-04-15'], 'skipped months stay skipped');
    equal(await cursorOf(paused.id), '2026-04-15');
    equal(debtorEmails().length, 1);
    ok((await auditTypes(paused.id)).includes('billing.active'));

    await BillingRepository.patch(db, OWNER, paused.id, { state: BillingState.Ended }, date('2026-04-16'), undefined, context);
    ok((await auditTypes(paused.id)).includes('billing.ended'));
  });

  it('materializes inline when the due day moves to a date already reached', async () => {
    sent.reset();

    const created = await BillingRepository.create(
      db,
      OWNER,
      'cron-reschedule',
      monthly('Remarcada', '2027-06-10'),
      date('2027-01-01'),
      undefined,
      context
    );

    deepEqual(await dueDates(created.id), []);

    await rejects(
      () => BillingRepository.patch(db, OWNER, created.id, { startDate: '2027-07-14' }, date('2027-07-15'), undefined, context),
      RangeError,
      'the next due date never lands behind today'
    );

    const patched = await BillingRepository.patch(
      db,
      OWNER,
      created.id,
      { startDate: '2027-07-15' },
      date('2027-07-15'),
      undefined,
      context
    );

    equal(patched.startDate, '2027-07-15');
    deepEqual(await dueDates(created.id), ['2027-07-15'], 'today is due today');
    equal(debtorEmails().length, 1);
    deepEqual((await EventRepository.list(db, patched.charges[0]!.id, 'notice.sent'))[0]?.payload, {
      template: 'initial',
      channels: ['email']
    });

    await BillingRepository.patch(db, OWNER, created.id, { state: BillingState.Ended }, date('2027-07-16'), undefined, context);
  });

  it('audits an archived recipient on one billing without stopping the others', async () => {
    sent.reset();

    const archived = await ContactRepository.save(db, OWNER, { name: 'Arquivado', email: 'daily-cron-archived@example.com' });
    const billing = await BillingRepository.create(
      db,
      OWNER,
      'cron-archived',
      monthly('Arquivada', '2026-03-31', {
        split: { mode: 'fixed', parts: [{ kind: 'user', userId: archived.userId, amountCents: 4_000 }] }
      }),
      date('2026-01-01'),
      undefined,
      context
    );

    await ContactRepository.archive(db, OWNER, archived.id);

    ok(
      (await BillingRepository.materializeDueBillings(db, context, cronAt('2026-03-31'))) >= 1,
      'the healthy billing still gets its charge'
    );
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28', '2026-03-31']);
    equal(debtorEmails().length, 1);

    deepEqual(await dueDates(billing.id), []);
    equal(await cursorOf(billing.id), '2025-12-31', 'the cursor stays where creation left it');
    ok((await auditTypes(billing.id)).includes('billing.materialization_skipped'));
    equal(sent.emails.filter((email) => email.to === 'daily-cron-archived@example.com').length, 0);
    deepEqual(await BillingRepository.materializeDue(db, billing.id, context, cronAt('2026-03-31')), {
      materialized: false,
      skipped: 'Contato indisponível.'
    });

    await BillingRepository.patch(db, OWNER, billing.id, { state: BillingState.Ended }, date('2026-04-01'), undefined, context);
  });

  it('arms 06:00 of the billing timezone for the reminders of the next twenty-four hours only', async () => {
    const [january, february, march] = await charges(monthlyId);

    ok(january && february && march);
    equal(reminderAt('2026-03-31').toISOString(), '2026-03-31T09:00:00.000Z');

    // At 05:00 UTC of the due date, 06:00 in São Paulo is four hours ahead: inside the window.
    const today = await plan(cronAt('2026-03-31'));

    deepEqual(today.get(notifyIdentifier(march.id)), {
      date: reminderAt('2026-03-31'),
      event: { chargeId: march.id, template: 'reminder', stage: 'first', offsetDays: 0 }
    });
    equal(today.has(notifyIdentifier(january.id)), false, 'a reminder already behind is not replayed');
    equal(today.has(notifyIdentifier(february.id)), false);

    // The day before it is 28 hours ahead; the day after it is behind.
    equal((await plan(cronAt('2026-03-30'))).has(notifyIdentifier(march.id)), false);
    equal((await plan(cronAt('2026-04-01'))).has(notifyIdentifier(march.id)), false);

    // A settled charge has no reminder left.
    await ChargeRepository.pay(db, OWNER, march.id, date('2026-03-30'));
    equal((await plan(cronAt('2026-03-31'))).has(notifyIdentifier(march.id)), false);

    // Neither has a cancelled one: ending the billing closes its pending charges.
    ok((await plan(cronAt('2026-02-28'))).has(notifyIdentifier(february.id)));
    await BillingRepository.patch(db, OWNER, monthlyId, { state: BillingState.Ended }, date('2026-04-02'), undefined, context);
    equal((await plan(cronAt('2026-02-28'))).has(notifyIdentifier(february.id)), false);
  });

  it('plans custom offsets and ignores disabled ones', async () => {
    sent.reset();

    // An enabled early reminder pulls the materialization forward: the charge exists five days before it is due.
    ok((await BillingRepository.materializeDueBillings(db, context, cronAt('2026-06-25'))) >= 1);

    const [june] = await charges(earlyId);

    ok(june);
    equal(june.due_date, '2026-06-30');

    deepEqual((await plan(cronAt('2026-06-25'))).get(notifyIdentifier(june.id)), {
      date: reminderAt('2026-06-25'),
      event: { chargeId: june.id, template: 'reminder', stage: 'first', offsetDays: -5 }
    });
    equal((await plan(cronAt('2026-06-30'))).has(notifyIdentifier(june.id)), false, 'the disabled due-date offset never counts');

    await BillingRepository.patch(db, OWNER, earlyId, { state: BillingState.Ended }, date('2026-07-01'), undefined, context);
  });
});
