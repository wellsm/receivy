import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../../database';
import type { ChargeNotifyScheduler } from '../schedulers/charge-notify';
import { planReminders } from '../services/send';

/**
 * Daily at 05:30 UTC, after `BillingCron` has created the day's charges: arms `charge:<id>:notify` for
 * every reminder whose 06:00 (billing timezone) falls in the next 24 hours. Nothing is sent here; the
 * schedule sends at the right hour. Idempotent: re-arming the same identifier is a no-op.
 */
export declare class ChargeNotificationCron extends Cron.Service {
  expression: 'cron(30 5 * * ? *)';

  timezone: 'UTC';

  maxRetries: 1;

  target: Cron.UseTarget<{
    handler: typeof handler;
    timeout: 300;
  }>;

  services: {
    db: Environment.Service<Db>;
    chargeNotifyScheduler: Environment.Service<ChargeNotifyScheduler>;
  };
}

export async function handler(
  _request: Cron.Incoming<null>,
  { db, chargeNotifyScheduler }: Service.Context<ChargeNotificationCron>
): Promise<void> {
  const planned = await planReminders(db, chargeNotifyScheduler, Date.now());

  // Counts only; never owner or recipient data.
  console.info('Charge notification cron', { planned });
}
