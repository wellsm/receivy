import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import { addCalendarDays, civilHour } from '@receivy/common';
import { effectiveReminders } from '../billings/repository';
import { CHARGE_SELECT } from '../charges/repository';
import type { Db, DbClient } from '../database';
import {
  civilDate,
  dueReminderOffsets,
  enqueueDue,
  type NoticeQueue,
  type NotificationConfig,
  notificationConfigFrom,
  planNotice,
  QUEUE_STALE_MS,
  REMINDER_HOUR
} from './planner';
import type { NotificationQueue } from './queue';

/** Reminder offsets never reach beyond a season, so the candidate window stays bounded. */
const REMINDER_WINDOW_DAYS = 90;

const ENQUEUE_LIMIT = 500;

export declare class NotificationCron extends Cron.Service {
  expression: 'cron(0/5 * * * ? *)';

  timezone: 'UTC';

  maxRetries: 1;

  target: Cron.UseTarget<{
    handler: typeof notificationCronHandler;
    timeout: 300;
  }>;

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

type ReminderCandidate = {
  chargeId: string;
  dueDate: string;
  reminders?: string;
  timezone: string;
};

async function reminderCandidates(db: DbClient, now: number): Promise<ReminderCandidate[]> {
  const today = civilDate(now, 'UTC');

  // One extra day on each side absorbs the civil-date drift between UTC and the billing timezone.
  const from = addCalendarDays(today, -(REMINDER_WINDOW_DAYS + 1));
  const to = addCalendarDays(today, REMINDER_WINDOW_DAYS + 1);

  const rows = await db.rawQuery(
    `SELECT c.id AS charge_id, to_char(c.due_date, 'YYYY-MM-DD') AS due_date, b.reminders, b.timezone
    FROM charges c JOIN billings b ON b.id = c.billing_id
    WHERE c.state = 'pending' AND b.state = 'active' AND c.due_date BETWEEN :from::date AND :to::date
    ORDER BY c.due_date`,
    { from, to }
  );

  return rows.map((row) => ({
    chargeId: String(row['charge_id']),
    dueDate: String(row['due_date']),
    reminders: row['reminders'] === null || row['reminders'] === undefined ? undefined : String(row['reminders']),
    timezone: String(row['timezone'])
  }));
}

/** Plans the reminders whose civil date and hour arrived; repeated passes are inert. */
export async function planDueReminders(db: DbClient, config: NotificationConfig, now: number): Promise<number> {
  const candidates = await reminderCandidates(db, now);

  let planned = 0;

  for (const candidate of candidates) {
    if (civilHour(now, candidate.timezone) < REMINDER_HOUR) {
      continue;
    }

    const today = civilDate(now, candidate.timezone);
    const offsets = dueReminderOffsets(effectiveReminders({ reminders: candidate.reminders }), candidate.dueDate, today);

    for (const offset of offsets) {
      const created = await db.transaction(async (tx) => {
        // Shared lock order with manual reminders, capability changes and proof finalization.
        const charge = await tx.charges.findOne({
          select: CHARGE_SELECT,
          where: { id: candidate.chargeId },
          lock: true
        });

        if (!charge || charge.state !== 'pending') {
          return 0;
        }

        const creditor = await tx.users.findOne({
          select: { id: true },
          where: { id: charge.creditor_id, deleted_at: { isNull: true } }
        });

        if (!creditor) {
          return 0;
        }

        const notice = await planNotice(tx, charge, `charge:${charge.id}:reminder:${today}:${offset}`, 'reminder', config, now);

        return notice.deliveryIds.length;
      });

      planned += created;
    }
  }

  return planned;
}

/** Publishes every due delivery, including the ones whose message was lost in transit. */
export async function enqueueDueDeliveries(db: DbClient, queue: NoticeQueue, now: number): Promise<number> {
  const rows = await db.rawQuery(
    `SELECT id FROM notification_deliveries
    WHERE available_at <= :now
      AND (state IN ('pending', 'sending') OR (state = 'accepted' AND channel = 'push'))
      AND (queued_at IS NULL OR queued_at < :stale)
    ORDER BY available_at
    LIMIT ${ENQUEUE_LIMIT}`,
    { now: new Date(now).toISOString(), stale: new Date(now - QUEUE_STALE_MS).toISOString() }
  );

  return enqueueDue(
    db,
    queue,
    rows.map((row) => String(row['id'])),
    now
  );
}

export async function notificationCronHandler(_request: Cron.Incoming<null>, context: Service.Context<NotificationCron>): Promise<void> {
  const config = notificationConfigFrom(context.variables);

  if (!config.secret || config.secret === 'disabled') {
    console.info('Notification cron', { status: 'disabled' });
    return;
  }

  const now = Date.now();
  const planned = await planDueReminders(context.db, config, now);
  const enqueued = await enqueueDueDeliveries(context.db, context.notificationQueue, now);

  // Counts only; never provider payload or recipients.
  console.info('Notification cron', { planned, enqueued });
}
