import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpNotFoundError } from '@ez4/gateway';
import { type PlanInvoice, type PlanSummary, PlanTier, type SetupResult, type SubscribeResult, SubscriptionStatus, planOf } from '@receivy/common';
import type { Db, DbClient } from '../../database';
import { notificationTransport } from '../../notifications/services/transport';
import { AccountRepository } from '../../users/repositories/account';
import { createStripeClient } from '../../vendors/stripe/client';
import { fakeStripe } from '../../vendors/stripe/fake';
import type { StripeClient } from '../../vendors/stripe/types';
import { PlanAlreadyActiveError, PlanBillingDisabledError, PlanUnavailableError } from '../errors';
import { SubscriptionRepository } from '../repositories/subscription';
import { limitsOf } from './limits';
import { type PlanNotices, syncSubscription } from './sync';

export const enum PlanBillingMode {
  Live = 'live',
  Fake = 'fake',
  Disabled = 'disabled'
}

export type PlanVariables = {
  PLAN_BILLING?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_BASIC?: string;
  PUBLIC_WEB_ORIGIN?: string;
  RESEND_FROM_EMAIL?: string;
};

/** `PLAN_BILLING` picks the client: `live` talks to Stripe (or answers disabled without a real key), `fake` answers in-process, anything else is off (null). */
export function stripeOf(variables: PlanVariables): StripeClient | null {
  if (variables.PLAN_BILLING === PlanBillingMode.Live) {
    if (!variables.STRIPE_SECRET_KEY || variables.STRIPE_SECRET_KEY === 'disabled') {
      return null;
    }

    return createStripeClient(variables.STRIPE_SECRET_KEY);
  }

  if (variables.PLAN_BILLING === PlanBillingMode.Fake) {
    return fakeStripe();
  }

  return null;
}

export function planNoticesOf(variables: Record<string, string | undefined>): PlanNotices {
  return { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000', from: variables.RESEND_FROM_EMAIL ?? 'disabled' };
}

export type PlanClient = {
  get(ownerId: string, now?: Date): Promise<PlanSummary>;
  subscribe(ownerId: string, now?: Date): Promise<SubscribeResult>;
  cancel(ownerId: string, now?: Date): Promise<void>;
  resume(ownerId: string, now?: Date): Promise<void>;
  setupPaymentMethod(ownerId: string): Promise<SetupResult>;
  confirmPaymentMethod(ownerId: string, paymentMethodId: string): Promise<void>;
  invoices(ownerId: string): Promise<PlanInvoice[]>;
};

export declare class PlanService extends Factory.Service<PlanClient> {
  handler: typeof createService;
  variables: {
    PLAN_BILLING: Environment.VariableOrValue<'PLAN_BILLING', 'disabled'>;
    STRIPE_SECRET_KEY: Environment.VariableOrValue<'STRIPE_SECRET_KEY', 'disabled'>;
    STRIPE_PRICE_BASIC: Environment.VariableOrValue<'STRIPE_PRICE_BASIC', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_API_KEY: Environment.Variable<'RESEND_API_KEY'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    MAILPIT_API_URL: Environment.VariableOrValue<'MAILPIT_API_URL', 'http://127.0.0.1:8025'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
  };
  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };
}

function requireStripe(stripe: StripeClient | null): StripeClient {
  if (!stripe) {
    throw new PlanBillingDisabledError();
  }

  return stripe;
}

async function summary(db: DbClient, stripe: StripeClient | null, ownerId: string, now: Date): Promise<PlanSummary> {
  const row = await SubscriptionRepository.get(db, ownerId);
  const { plan, limits, used } = await limitsOf(db, ownerId, now);
  const card = row && stripe ? await stripe.defaultCard(row.stripe_customer_id) : null;

  return {
    plan,
    status: row?.status ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    usage: { indefinite: { used, limit: limits.indefinite } },
    checkoutLinks: limits.checkoutLinks,
    card: card?.status === 'ok' ? card.card : null
  };
}

/** The customer row is created once and kept forever: a second subscription reuses it. */
async function ensureRow(db: DbClient, stripe: StripeClient, ownerId: string, now: Date): Promise<SubscriptionRepository.Row> {
  const existing = await SubscriptionRepository.get(db, ownerId, true);

  if (existing) {
    return existing;
  }

  const account = await AccountRepository.get(db, ownerId);
  const customer = await stripe.createCustomer({ ownerId, email: account?.verified_email ?? account?.email, name: account?.name });

  if (customer.status !== 'ok') {
    throw new PlanUnavailableError();
  }

  return SubscriptionRepository.insert(db, { ownerId, customerId: customer.customerId, now: now.toISOString() });
}

async function subscribe(db: DbClient, stripe: StripeClient, variables: PlanVariables, notices: PlanNotices, ownerId: string, now: Date): Promise<SubscribeResult> {
  const priceId = variables.STRIPE_PRICE_BASIC ?? 'disabled';

  if (priceId === 'disabled') {
    throw new PlanBillingDisabledError();
  }

  const { row, created } = await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const current = await ensureRow(tx, stripe, ownerId, now);

    if (planOf(SubscriptionRepository.snapshotOf(current), now) !== PlanTier.Free) {
      throw new PlanAlreadyActiveError();
    }

    const result = await stripe.createSubscription({ customerId: current.stripe_customer_id, priceId });

    if (result.status !== 'ok') {
      throw new PlanUnavailableError();
    }

    await SubscriptionRepository.setSubscription(tx, current.id, { stripeSubscriptionId: result.subscriptionId, status: SubscriptionStatus.Incomplete, now: now.toISOString() });

    return { row: { ...current, stripe_subscription_id: result.subscriptionId, status: SubscriptionStatus.Incomplete }, created: result };
  });

  // Fake mode has no webhook: the subscription is live already, so the same sync the webhook runs applies it here.
  if (variables.PLAN_BILLING === PlanBillingMode.Fake) {
    await syncSubscription(db, stripe, notices, row, now);
  }

  return { clientSecret: created.clientSecret };
}

async function liveRow(db: DbClient, ownerId: string, now: Date): Promise<SubscriptionRepository.Row & { stripe_subscription_id: string }> {
  const row = await SubscriptionRepository.get(db, ownerId);

  if (!row?.stripe_subscription_id || planOf(SubscriptionRepository.snapshotOf(row), now) === PlanTier.Free) {
    throw new HttpNotFoundError();
  }

  return row as SubscriptionRepository.Row & { stripe_subscription_id: string };
}

async function setCancel(db: DbClient, stripe: StripeClient, ownerId: string, cancel: boolean, now: Date): Promise<void> {
  const row = await liveRow(db, ownerId, now);
  const result = await stripe.setCancelAtPeriodEnd(row.stripe_subscription_id, cancel);

  if (result.status !== 'ok') {
    throw new PlanUnavailableError();
  }

  await SubscriptionRepository.applyState(db, row.id, { status: result.subscription.status, currentPeriodEnd: result.subscription.currentPeriodEnd, cancelAtPeriodEnd: result.subscription.cancelAtPeriodEnd, eventId: null, eventAt: null, now: now.toISOString() });
}

export function createService({ db, variables }: Service.Context<PlanService>): PlanClient {
  const stripe = stripeOf(variables);
  const notices = planNoticesOf(variables);

  return {
    get: (ownerId, now = new Date()) => summary(db, stripe, ownerId, now),
    subscribe: async (ownerId, now = new Date()) => subscribe(db, requireStripe(stripe), variables, notices, ownerId, now),
    cancel: async (ownerId, now = new Date()) => setCancel(db, requireStripe(stripe), ownerId, true, now),
    resume: async (ownerId, now = new Date()) => setCancel(db, requireStripe(stripe), ownerId, false, now),
    setupPaymentMethod: async (ownerId) => {
      const row = await liveRow(db, ownerId, new Date());
      const result = await requireStripe(stripe).createSetupIntent(row.stripe_customer_id);

      if (result.status !== 'ok') {
        throw new PlanUnavailableError();
      }

      return { clientSecret: result.clientSecret };
    },
    confirmPaymentMethod: async (ownerId, paymentMethodId) => {
      const row = await liveRow(db, ownerId, new Date());
      const result = await requireStripe(stripe).setDefaultPaymentMethod({ customerId: row.stripe_customer_id, subscriptionId: row.stripe_subscription_id, paymentMethodId });

      if (result.status !== 'ok') {
        throw new PlanUnavailableError();
      }
    },
    invoices: async (ownerId) => {
      const row = await SubscriptionRepository.get(db, ownerId);

      if (!row || !stripe) {
        return [];
      }

      const result = await stripe.listInvoices(row.stripe_customer_id, 12);

      return result.status === 'ok' ? result.invoices : [];
    }
  };
}
