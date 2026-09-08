import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import { materializeRecurrences } from './repository';

export declare class RecurrenceScheduler extends Cron.Service {
  expression: 'cron(0 * * * ? *)';
  timezone: 'UTC';
  maxRetries: 3;
  target: Cron.UseTarget<{ handler: typeof recurrenceJobHandler; timeout: 300 }>;
  services: { db: Environment.Service<Db> };
}
export async function recurrenceJobHandler(_request: Cron.Incoming<null>, context: Service.Context<RecurrenceScheduler>): Promise<void> {
  const result = await materializeRecurrences(context.db);
  if (result.failures.length) console.error('Recurrence materialization requires owner action', { recurrenceIds: result.failures });
}
