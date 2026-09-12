import { deepEqual, equal, ok } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { QueueTester } from '@ez4/local-queue/test';
import { enqueueDueBillings } from '../../src/billings/cron';
import type { BillingQueue } from '../../src/billings/queue';
import { materializeBillingOccurrence } from '../../src/billings/queue';
import { createBilling, dueIndefiniteBillings, materializeNextOccurrence, patchBilling } from '../../src/billings/repository';
import type { NoticeContext } from '../../src/notifications/planner';
import type { NotificationQueue } from '../../src/notifications/queue';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { archivePerson, savePerson } from '../../src/people/repository';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = 'b5555555-5555-4555-8555-555555555555';

const date = (value: string) => new Date(`${value}T12:00:00Z`);

const config = {
  publicOrigin: 'https://receivy.example',
  secret: 'billing-queue-secret-with-enough-entropy',
  from: 'fixture@example.invalid'
};

QueueTester.setClientMock<NotificationQueue>('NotificationQueue');
QueueTester.setClientMock<BillingQueue>('BillingQueue');

const notifications = QueueTester.getClientMock<NotificationQueue>('NotificationQueue');
const billings = QueueTester.getClientMock<BillingQueue>('BillingQueue');

const notice: NoticeContext = { config, queue: notifications };

const context: Parameters<typeof materializeBillingOccurrence>[1] = {
  db,
  notificationQueue: notifications,
  billingQueue: billings,
  variables: {
    APP_STAGE: 'test',
    NOTIFICATION_PUSH_TRANSPORT: 'disabled',
    RESEND_FROM_EMAIL: config.from,
    PUBLIC_WEB_ORIGIN: config.publicOrigin,
    PUBLIC_LINK_HMAC_SECRET: config.secret
  }
};

const incoming = (billingId: string, attempt = 1) => ({
  requestId: 'billing-queue-spec',
  traceId: 'billing-queue-trace',
  attempt,
  maxAttempts: 5,
  message: { billingId },
  retry: async () => {}
});

function forget() {
  notifications.sendMessage.mock.resetCalls();
  billings.sendMessage.mock.resetCalls();
}

function enqueuedBillingIds(): string[] {
  return billings.sendMessage.mock.calls.map((call) => call.arguments[0]!.billingId);
}

async function dueDates(billingId: string): Promise<string[]> {
  const found = await db.charges.findMany({
    select: { due_date: true },
    where: { billing_id: billingId },
    order: { due_date: Order.Asc }
  });

  return found.records.map((row) => row.due_date);
}

async function cursorOf(billingId: string): Promise<string | undefined> {
  const row = await db.billings.findOne({ select: { processed_through: true }, where: { id: billingId } });

  return row?.processed_through;
}

async function auditTypes(billingId: string): Promise<string[]> {
  const found = await db.activity_events.findMany({
    select: { type: true },
    where: { aggregate_type: 'billing', aggregate_id: billingId }
  });

  return found.records.map((row) => row.type);
}

let personId: string;
let pixId: string;
let monthlyId: string;
let archivedBillingId: string;

describe('queued billing materialization', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'billing-queue-owner@example.com', name: 'Dona' });

    personId = (await savePerson(db, OWNER, { name: 'Bruno', email: 'billing-queue-debtor@example.com' })).id;
    pixId = (await savePaymentMethod(db, OWNER, { pixKeyType: 'cpf', pixKey: '52998224725', label: 'Principal' })).id;

    const monthly = await createBilling(
      db,
      OWNER,
      'queue-monthly',
      {
        type: 'indefinite',
        frequency: 'monthly',
        description: 'Mensalidade',
        totalCents: 4_000,
        startDate: '2026-01-31',
        timezone: 'America/Sao_Paulo',
        paymentMethodId: pixId,
        split: { mode: 'fixed', parts: [{ kind: 'person', personId, amountCents: 4_000 }] }
      },
      date('2026-01-01')
    );

    monthlyId = monthly.id;
  });

  after(async () => cleanupUsers(db, [OWNER]));

  it('enqueues only the billings whose next occurrence reached its materialization date', async () => {
    forget();

    const later = await createBilling(
      db,
      OWNER,
      'queue-later',
      {
        type: 'indefinite',
        frequency: 'monthly',
        description: 'Semestral',
        totalCents: 1_000,
        startDate: '2026-06-30',
        timezone: 'America/Sao_Paulo',
        paymentMethodId: pixId,
        split: { mode: 'fixed', parts: [{ kind: 'person', personId, amountCents: 1_000 }] }
      },
      date('2026-01-01')
    );

    deepEqual(await dueIndefiniteBillings(db, date('2026-01-15')), []);
    deepEqual(await dueIndefiniteBillings(db, date('2026-01-31')), [monthlyId]);

    equal(await enqueueDueBillings(db, billings, date('2026-01-31')), 1);
    deepEqual(enqueuedBillingIds(), [monthlyId]);

    await patchBilling(db, OWNER, later.id, { state: 'ended' });
  });

  it('materializes one occurrence per message, queues its notice and chains while occurrences remain', async () => {
    forget();

    await materializeBillingOccurrence(incoming(monthlyId), context);

    deepEqual(await dueDates(monthlyId), ['2026-01-31']);
    equal(await cursorOf(monthlyId), '2026-01-31');
    ok((await auditTypes(monthlyId)).includes('billing.materialized'));

    equal(notifications.sendMessage.mock.calls.length, 1);

    const queuedDelivery = notifications.sendMessage.mock.calls[0]!.arguments[0]!.deliveryId;
    const delivery = await db.notification_deliveries.findOne({
      select: { charge_id: true, template: true, queued_at: true },
      where: { id: queuedDelivery }
    });

    equal(delivery?.template, 'initial');
    ok(delivery?.queued_at, 'the committed row is stamped only after the message is sent');

    // February is due as well, so the consumer hands the billing back to its own queue.
    deepEqual(enqueuedBillingIds(), [monthlyId]);

    forget();

    await materializeBillingOccurrence(incoming(monthlyId), context);

    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28']);
    equal(await cursorOf(monthlyId), '2026-02-28');
  });

  it('only advances the cursor when the occurrence already has a charge', async () => {
    forget();

    await db.billings.updateOne({ where: { id: monthlyId }, data: { processed_through: '2026-01-30' } });

    const result = await materializeNextOccurrence(db, monthlyId, notice, date('2026-02-05'));

    deepEqual(result, { materialized: false, remaining: false, dueDeliveryIds: [] });
    equal(await cursorOf(monthlyId), '2026-01-31');
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28']);
    equal(notifications.sendMessage.mock.calls.length, 0);
  });

  it('audits an archived recipient instead of failing the message', async () => {
    forget();

    const archived = await savePerson(db, OWNER, { name: 'Arquivado' });

    const billing = await createBilling(
      db,
      OWNER,
      'queue-archived',
      {
        type: 'indefinite',
        frequency: 'monthly',
        description: 'Arquivada',
        totalCents: 2_000,
        startDate: '2026-03-31',
        timezone: 'America/Sao_Paulo',
        paymentMethodId: pixId,
        split: { mode: 'fixed', parts: [{ kind: 'person', personId: archived.id, amountCents: 2_000 }] }
      },
      date('2026-01-01')
    );

    archivedBillingId = billing.id;

    await archivePerson(db, OWNER, archived.id);

    const result = await materializeNextOccurrence(db, archivedBillingId, notice, date('2026-03-31'));

    ok(result.skipped, 'an archived recipient is an owner problem, not a transient one');
    equal(result.materialized, false);
    equal(await cursorOf(archivedBillingId), '2025-12-31', 'the cursor stays where creation left it');
    ok((await auditTypes(archivedBillingId)).includes('billing.materialization_skipped'));
    deepEqual(await dueDates(archivedBillingId), []);

    forget();

    // The consumer swallows it too, so the message never reaches the dead-letter queue.
    await materializeBillingOccurrence(incoming(archivedBillingId), context);

    equal(notifications.sendMessage.mock.calls.length, 0);
    deepEqual(enqueuedBillingIds(), []);
  });

  it('leaves paused billings untouched', async () => {
    forget();

    await patchBilling(db, OWNER, monthlyId, { state: 'paused' }, date('2026-03-01'));

    ok(!(await dueIndefiniteBillings(db, date('2026-04-30'))).includes(monthlyId));

    const result = await materializeNextOccurrence(db, monthlyId, notice, date('2026-04-30'));

    deepEqual(result, { materialized: false, remaining: false, dueDeliveryIds: [] });
    deepEqual(await dueDates(monthlyId), ['2026-01-31', '2026-02-28']);
    equal(notifications.sendMessage.mock.calls.length, 0);

    await patchBilling(db, OWNER, monthlyId, { state: 'ended' });
    await patchBilling(db, OWNER, archivedBillingId, { state: 'ended' });
  });
});
