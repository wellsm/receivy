import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { EmailService } from '../../common/services/email/service';
import type { Db } from '../../database';
import type { ChargeNotifyScheduler } from '../../notifications/schedulers/charge-notify';
import { notificationConfigFrom } from '../../notifications/services/planner';
import { notificationTransport } from '../../notifications/services/transport';
import { BillingRepository } from '../repositories/billing';

/**
 * Daily at 05:00 UTC, past midnight in every Brazilian timezone: every active assinatura gets the
 * occurrences that came due, and their initial notices go out; then every registro pays what came due.
 * Creation and patches materialize inline, so this only covers "the day turned". Idempotent: a second
 * run finds nothing to do.
 */
export declare class BillingCron extends Cron.Service {
  expression: 'cron(0 5 * * ? *)';

  timezone: 'UTC';

  maxRetries: 1;

  target: Cron.UseTarget<{
    handler: typeof handler;
    timeout: 300;
  }>;

  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    chargeNotifyScheduler: Environment.Service<ChargeNotifyScheduler>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_API_KEY: Environment.Variable<'RESEND_API_KEY'>;
    RESEND_FROM_EMAIL: Environment.VariableOrValue<'RESEND_FROM_EMAIL', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };
}

export async function handler(
  _request: Cron.Incoming<null>,
  { db, variables, email, chargeNotifyScheduler }: Service.Context<BillingCron>
): Promise<void> {
  const now = new Date();
  const notice = {
    config: notificationConfigFrom(variables),
    transport: notificationTransport(variables, globalThis.fetch, email),
    notify: chargeNotifyScheduler
  };

  const materialized = await BillingRepository.materializeDueBillings(db, notice, now);
  // After the sweep: the occurrence it just created is already paid, and this pays what came due since yesterday.
  const settled = await BillingRepository.settleRegistered(db, now);

  // Counts only; never owner or recipient data.
  console.info('Billing cron', { materialized, settled });
}
