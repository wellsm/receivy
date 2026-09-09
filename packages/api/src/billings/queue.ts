import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { String } from '@ez4/schema';
import type { Db } from '../database';
import { noticeContext } from '../notifications/context';
import { enqueueDue } from '../notifications/planner';
import type { NotificationQueue } from '../notifications/queue';
import { materializeNextOccurrence } from './repository';

export declare class BillingMessage implements Queue.Message {
  billingId: String.UUID;
}

export declare class BillingQueue extends Queue.Unordered<BillingMessage> {
  deadLetter: Queue.UseDeadLetter<{ maxAttempts: 5; retention: 20160 }>;

  backoff: Queue.UseBackoff<{ minDelay: 5; maxDelay: 300 }>;

  timeout: 120;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof materializeBillingOccurrence;
      concurrency: 2;
    }>
  ];

  services: {
    db: Environment.Service<Db>;
    notificationQueue: Environment.Service<NotificationQueue>;
    billingQueue: Environment.Service<BillingQueue>;
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

/**
 * Materializes exactly one occurrence per message and self-chains while occurrences remain,
 * so a long-idle billing catches up without a global budget.
 */
export async function materializeBillingOccurrence(
  request: Queue.Incoming<BillingMessage>,
  context: Service.Context<BillingQueue>
): Promise<void> {
  const { billingId } = request.message;
  const notice = noticeContext(context);
  const result = await materializeNextOccurrence(context.db, billingId, notice, new Date());

  if (result.skipped) {
    // Owner action, not a transient failure: retrying would only drain the queue attempts.
    console.warn('Billing materialization skipped', { billingId, reason: result.skipped });
    return;
  }

  // The occurrence is committed before its notices reach the notification queue.
  await enqueueDue(context.db, notice.queue, result.dueDeliveryIds, Date.now());

  if (result.remaining) {
    await context.billingQueue.sendMessage({ billingId });
  }

  console.info('Billing materialization', { billingId, materialized: result.materialized, remaining: result.remaining });
}
