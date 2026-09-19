import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { createStripeClient } from './client';

const stripeConstructorCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock('stripe', () => ({
  default: class FakeStripeSdk {
    constructor(...args: unknown[]) {
      stripeConstructorCalls.push(args);
    }
  }
}));

const PERIOD_END = 1_792_000_000;

function sdkWith(overrides: Record<string, unknown> = {}) {
  return {
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })), retrieve: vi.fn(async () => ({ id: 'cus_1', invoice_settings: { default_payment_method: { card: { brand: 'visa', last4: '4242' } } } })), update: vi.fn(async () => ({})) },
    subscriptions: {
      create: vi.fn(async () => ({ id: 'sub_1', latest_invoice: { confirmation_secret: { client_secret: 'pi_secret' } } })),
      retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: PERIOD_END }] } })),
      update: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, items: { data: [{ current_period_end: PERIOD_END }] } }))
    },
    setupIntents: { create: vi.fn(async () => ({ client_secret: 'seti_secret' })) },
    invoices: { list: vi.fn(async () => ({ data: [{ id: 'in_1', amount_paid: 1990, status: 'paid', status_transitions: { paid_at: PERIOD_END }, invoice_pdf: 'https://stripe.example/in_1.pdf' }] })) },
    webhooks: { constructEvent: vi.fn(() => ({ id: 'evt_1', type: 'customer.subscription.updated', created: PERIOD_END, data: { object: { object: 'subscription', id: 'sub_1' } } })) },
    ...overrides
  } as never;
}

describe('createStripeClient', () => {
  it('builds its default SDK with a short timeout and one retry, since subscribe holds the owner lock while it talks to Stripe', () => {
    createStripeClient('sk_test');

    expect(stripeConstructorCalls.at(-1)).toEqual(['sk_test', { timeout: 10_000, maxNetworkRetries: 1 }]);
  });

  it('creates a subscription that waits for the first payment and returns its client secret', async () => {
    const sdk = sdkWith();
    const client = createStripeClient('sk_test', sdk);

    expect(await client.createSubscription({ customerId: 'cus_1', priceId: 'price_1' })).toEqual({ status: 'ok', subscriptionId: 'sub_1', clientSecret: 'pi_secret' });
    expect((sdk as never as { subscriptions: { create: ReturnType<typeof vi.fn> } }).subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', items: [{ price: 'price_1' }], payment_behavior: 'default_incomplete', expand: ['latest_invoice.confirmation_secret'] })
    );
  });

  it('reads the period end from the subscription item and maps statuses', async () => {
    const client = createStripeClient('sk_test', sdkWith());

    expect(await client.getSubscription('sub_1')).toEqual({ status: 'ok', subscription: { id: 'sub_1', customerId: 'cus_1', status: SubscriptionStatus.Active, currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(), cancelAtPeriodEnd: false } });
  });

  it('maps unpaid to past_due and incomplete_expired to canceled', async () => {
    const unpaid = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'unpaid', cancel_at_period_end: false, items: { data: [] } })) } }));
    const expired = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'incomplete_expired', cancel_at_period_end: false, items: { data: [] } })) } }));

    expect((await unpaid.getSubscription('sub_1')) as { subscription: { status: string } }).toMatchObject({ subscription: { status: SubscriptionStatus.PastDue, currentPeriodEnd: null } });
    expect((await expired.getSubscription('sub_1')) as { subscription: { status: string } }).toMatchObject({ subscription: { status: SubscriptionStatus.Canceled } });
  });

  it('answers not_found on a missing subscription and unavailable on any other failure', async () => {
    const missing = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => { throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' }); }) } }));
    const down = createStripeClient('sk_test', sdkWith({ subscriptions: { retrieve: vi.fn(async () => { throw new Error('ECONNRESET'); }) } }));

    expect(await missing.getSubscription('sub_x')).toEqual({ status: 'not_found' });
    expect(await down.getSubscription('sub_1')).toEqual({ status: 'unavailable' });
  });

  it('constructs a verified event and finds the subscription id on subscription and invoice objects', () => {
    const client = createStripeClient('sk_test', sdkWith());
    const invoiceSdk = sdkWith({ webhooks: { constructEvent: vi.fn(() => ({ id: 'evt_2', type: 'invoice.paid', created: PERIOD_END, data: { object: { object: 'invoice', id: 'in_1', parent: { subscription_details: { subscription: 'sub_9' } } } } })) } });

    expect(client.constructEvent('{}', 'sig', 'whsec')).toEqual({ status: 'ok', event: { id: 'evt_1', type: 'customer.subscription.updated', created: new Date(PERIOD_END * 1000).toISOString(), subscriptionId: 'sub_1' } });
    expect(createStripeClient('sk_test', invoiceSdk).constructEvent('{}', 'sig', 'whsec')).toMatchObject({ event: { subscriptionId: 'sub_9' } });
  });

  it('answers invalid when the signature does not verify or is missing', () => {
    const client = createStripeClient('sk_test', sdkWith({ webhooks: { constructEvent: vi.fn(() => { throw new Error('No signatures found'); }) } }));

    expect(client.constructEvent('{}', 'bad', 'whsec')).toEqual({ status: 'invalid' });
    expect(client.constructEvent('{}', undefined, 'whsec')).toEqual({ status: 'invalid' });
  });

  it('lists invoices as the client reads them and reads the default card', async () => {
    const client = createStripeClient('sk_test', sdkWith());

    expect(await client.listInvoices('cus_1', 12)).toEqual({ status: 'ok', invoices: [{ id: 'in_1', amountCents: 1990, status: 'paid', paidAt: new Date(PERIOD_END * 1000).toISOString(), pdfUrl: 'https://stripe.example/in_1.pdf' }] });
    expect(await client.defaultCard('cus_1')).toEqual({ status: 'ok', card: { brand: 'visa', last4: '4242' } });
  });
});
