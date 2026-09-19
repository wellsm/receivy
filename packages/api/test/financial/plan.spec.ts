import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BillingFrequency, BillingRecurrence, BillingState, type BillingInput, PaymentProvider, PlanTier, SplitMode, SplitPartKind, SubscriptionStatus } from '@receivy/common';
import { createBilling, patchBilling } from '../../src/billings/services/billing';
import { EventRepository } from '../../src/common/repositories/events';
import { SubscriptionRepository } from '../../src/plans/repositories/subscription';
import { planNoticesOf, stripeOf } from '../../src/plans/services/plan';
import { syncSubscription } from '../../src/plans/services/sync';
import { fakeStripeSetStatus } from '../../src/vendors/stripe/fake';
import { PLAN_VARIABLES, cleanupUsers, contacts, createUser, db, paymentMethods, plans } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = '99999999-9999-4999-8999-999999999995';
const PAYER = '99999999-9999-4999-8999-999999999996';

function indefiniteInput(userId: string, key: string): BillingInput {
  return {
    recurrence: BillingRecurrence.Indefinite,
    frequency: BillingFrequency.Monthly,
    description: `Assinatura ${key}`,
    totalCents: 1_000,
    startDate: '2999-01-10',
    timezone: 'America/Sao_Paulo',
    split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId, amountCents: 1_000 }] }
  };
}

async function indefinite(ownerId: string, userId: string, key: string) {
  const { context } = fakeNotice();

  return createBilling(db, ownerId, key, indefiniteInput(userId, key), new Date(), undefined, context);
}

describe('paid plan', () => {
  let payerId: string;
  const created: string[] = [];

  before(async () => {
    await createUser(db, { id: OWNER, email: 'plan-owner@example.com', name: 'Dona Plano' });
    await createUser(db, { id: PAYER, email: 'plan-payer@example.com', name: 'Ana Paga' });

    payerId = (await contacts.save(OWNER, { name: 'Ana', email: 'plan-payer@example.com' })).userId;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYER]));

  it('starts free, blocks the sixth indefinite and refuses a checkout method', async () => {
    for (let index = 1; index <= 5; index += 1) {
      created.push((await indefinite(OWNER, payerId, `plan-${index}`)).id);
    }

    equal((await plans.get(OWNER)).usage.indefinite.used, 5);
    await rejects(indefinite(OWNER, payerId, 'plan-6'), { context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '5', used: '5', plan: PlanTier.Free } } });
    await rejects(paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: '$loja' }), { context: { code: 'PLAN_REQUIRED' } });
  });

  it('subscribes in fake mode and raises the ceiling to 30 with links allowed', async () => {
    const result = await plans.subscribe(OWNER);

    ok(result.clientSecret.startsWith('pi_fake_'));

    const summary = await plans.get(OWNER);

    equal(summary.plan, PlanTier.Basic);
    equal(summary.usage.indefinite.limit, 30);
    equal(summary.checkoutLinks, true);
    equal((await EventRepository.list(db, OWNER, 'plan.subscribed')).length, 1);

    created.push((await indefinite(OWNER, payerId, 'plan-6')).id);

    const method = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: '$loja' });

    created.push(
      (
        await createBilling(
          db,
          OWNER,
          'plan-linked',
          {
            recurrence: BillingRecurrence.Once,
            description: 'Com link',
            totalCents: 500,
            startDate: '2999-02-01',
            timezone: 'America/Sao_Paulo',
            paymentMethodId: method.id,
            split: { mode: SplitMode.Fixed, parts: [{ kind: SplitPartKind.User, userId: payerId, amountCents: 500 }] }
          },
          new Date(),
          undefined,
          fakeNotice().context
        )
      ).id
    );
  });

  it('refuses a second subscription and mirrors cancel at period end', async () => {
    await rejects(plans.subscribe(OWNER), { context: { code: 'PLAN_ALREADY_ACTIVE' } });
    await plans.cancel(OWNER);
    equal((await plans.get(OWNER)).cancelAtPeriodEnd, true);
    await plans.resume(OWNER);
    equal((await plans.get(OWNER)).cancelAtPeriodEnd, false);
  });

  it('downgrades when the provider reports the subscription canceled: newest excess and linked billings pause', async () => {
    const row = (await SubscriptionRepository.get(db, OWNER))!;

    fakeStripeSetStatus(row.stripe_subscription_id!, SubscriptionStatus.Canceled);

    const outcome = await syncSubscription(db, stripeOf(PLAN_VARIABLES)!, planNoticesOf(PLAN_VARIABLES), row, new Date(), { id: 'evt_cancel', created: new Date().toISOString(), type: 'customer.subscription.deleted' });

    equal(outcome, 'applied');

    const summary = await plans.get(OWNER);
    const sixth = created[5]!;
    const linked = created[6]!;
    const paused = await db.billings.findMany({ select: { id: true, state: true }, where: { owner_id: OWNER, state: BillingState.Paused } });

    equal(summary.plan, PlanTier.Free);
    equal(summary.usage.indefinite.used, 5);
    ok(paused.records.some((billing) => billing.id === sixth));
    ok(paused.records.some((billing) => billing.id === linked));
    equal((await EventRepository.list(db, sixth, 'billing.paused')).length, 1);
    equal((await EventRepository.list(db, OWNER, 'plan.canceled')).length, 1);
  });

  it('replays the same event without a second downgrade', async () => {
    const row = (await SubscriptionRepository.get(db, OWNER))!;

    equal(await syncSubscription(db, stripeOf(PLAN_VARIABLES)!, planNoticesOf(PLAN_VARIABLES), row, new Date(), { id: 'evt_cancel', created: new Date().toISOString(), type: 'customer.subscription.deleted' }), 'replayed');
    equal((await EventRepository.list(db, OWNER, 'plan.canceled')).length, 1);
  });

  it('makes a paused excess indefinite pass the limit again on reactivation', async () => {
    const sixth = created[5]!;

    await rejects(patchBilling(db, OWNER, sixth, { state: BillingState.Active }), { context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '5', used: '5', plan: PlanTier.Free } } });
  });
});
