import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import { noticeContext } from '../notifications/context';
import { enqueueDue } from '../notifications/planner';
import type { NotificationQueue } from '../notifications/queue';
import { materializeBillings } from './repository';

export declare class BillingScheduler extends Cron.Service {
  expression: 'cron(0 * * * ? *)';
  timezone: 'UTC';
  maxRetries: 3;
  target: Cron.UseTarget<{ handler: typeof billingJobHandler; timeout: 300 }>;
  services: {
    db: Environment.Service<Db>;
    notificationQueue: Environment.Service<NotificationQueue>;
    variables: Environment.ServiceVariables;
  };
  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    RESEND_FROM_EMAIL: Environment.VariableOrValue<'RESEND_FROM_EMAIL', 'disabled'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };
}

export async function billingJobHandler(_request: Cron.Incoming<null>, context: Service.Context<BillingScheduler>): Promise<void> {
  const notice = noticeContext(context);
  const result = await materializeBillings(context.db, new Date(), notice);

  // Every occurrence is committed before its notice reaches the queue.
  await enqueueDue(context.db, notice.queue, result.dueDeliveryIds, Date.now());

  if (result.failures.length) {
    console.error('Billing materialization requires owner action', { billingIds: result.failures });
  }
}
