import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import { materializeBillings } from './repository';

export declare class BillingScheduler extends Cron.Service {
  expression: 'cron(0 * * * ? *)';
  timezone: 'UTC';
  maxRetries: 3;
  target: Cron.UseTarget<{ handler: typeof billingJobHandler; timeout: 300 }>;
  services: { db: Environment.Service<Db> };
}

export async function billingJobHandler(_request: Cron.Incoming<null>, context: Service.Context<BillingScheduler>): Promise<void> {
  const result = await materializeBillings(context.db);

  if (result.failures.length) {
    console.error('Billing materialization requires owner action', { billingIds: result.failures });
  }
}
