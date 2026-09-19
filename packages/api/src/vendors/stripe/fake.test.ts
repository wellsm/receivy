import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { fakeStripe, fakeStripeSetStatus } from './fake';

describe('fakeStripe', () => {
  it('activates a subscription on creation and reads it back', async () => {
    const stripe = fakeStripe();
    const created = await stripe.createSubscription({ customerId: 'cus_fake_o1', priceId: 'price_x' });

    expect(created.status).toBe('ok');

    const id = (created as { subscriptionId: string }).subscriptionId;

    expect(await stripe.getSubscription(id)).toMatchObject({ status: 'ok', subscription: { id, status: SubscriptionStatus.Active, cancelAtPeriodEnd: false } });
  });

  it('flips cancel at period end and honours a status pushed by a test', async () => {
    const stripe = fakeStripe();
    const { subscriptionId } = (await stripe.createSubscription({ customerId: 'cus_fake_o1', priceId: 'price_x' })) as { subscriptionId: string };

    expect(await stripe.setCancelAtPeriodEnd(subscriptionId, true)).toMatchObject({ subscription: { cancelAtPeriodEnd: true } });

    fakeStripeSetStatus(subscriptionId, SubscriptionStatus.Canceled);

    expect(await stripe.getSubscription(subscriptionId)).toMatchObject({ subscription: { status: SubscriptionStatus.Canceled } });
  });

  it('only accepts events signed with the literal fake', () => {
    const stripe = fakeStripe();
    const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', subscriptionId: 'sub_fake_1' });

    expect(stripe.constructEvent(body, 'fake', 'x')).toMatchObject({ status: 'ok', event: { id: 'evt_1', subscriptionId: 'sub_fake_1' } });
    expect(stripe.constructEvent(body, 'nope', 'x')).toEqual({ status: 'invalid' });
    expect(stripe.constructEvent('{', 'fake', 'x')).toEqual({ status: 'invalid' });
  });
});
