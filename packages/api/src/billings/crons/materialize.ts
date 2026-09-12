import type { Environment, Service } from '@ez4/common';
import type { Client } from '@ez4/queue';
import type { Cron } from '@ez4/scheduler';
import type { Db, DbClient } from '../database';
import type { BillingQueue } from './queue';
import { dueIndefiniteBillings } from './repository';

export type OccurrenceMessage = { billingId: string };

/** Structural view of the queue client so producers never import the queue declaration. */
export type BillingEnqueue = Pick<Client<OccurrenceMessage, { fairMode: true }>, 'sendMessage'>;

export declare class BillingCron extends Cron.Service {
  expression: 'cron(0 * * * ? *)';

  timezone: 'UTC';

  maxRetries: 1;

  target: Cron.UseTarget<{
    handler: typeof billingCronHandler;
    timeout: 300;
  }>;

  services: {
    db: Environment.Service<Db>;
    billingQueue: Environment.Service<BillingQueue>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
  };
}

/** Hands every due billing to `BillingQueue`; the cron itself never materializes. */
export async function enqueueDueBillings(db: DbClient, queue: BillingEnqueue, now: Date): Promise<number> {
  const billingIds = await dueIndefiniteBillings(db, now);

  let enqueued = 0;

  for (const billingId of billingIds) {
    try {
      await queue.sendMessage({ billingId });

      enqueued++;
    } catch {
      // The billing keeps its cursor, so the next hourly pass publishes it again.
      console.error('Billing enqueue failed', { billingId });
    }
  }

  return enqueued;
}

export async function billingCronHandler(_request: Cron.Incoming<null>, context: Service.Context<BillingCron>): Promise<void> {
  const enqueued = await enqueueDueBillings(context.db, context.billingQueue, new Date());

  // Counts only; never owner or recipient data.
  console.info('Billing cron', { enqueued });
}
