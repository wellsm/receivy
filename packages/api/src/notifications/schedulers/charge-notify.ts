import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { String } from '@ez4/schema';
import { listEvents } from '../../common/repositories/events';
import type { EmailService } from '../../common/services/email/service';
import type { Db } from '../../database';
import { notificationConfigFrom } from '../services/planner';
import { followUpCharge, notifyCharge } from '../services/send';
import { notificationTransport } from '../services/transport';

export type ChargeNotifySchedule = {
  chargeId: String.UUID;
  template: 'initial' | 'reminder' | 'manual';
  stage: 'first' | 'followup';
  offsetDays?: number;
};

/**
 * `charge:<id>:notify`: one dynamic schedule per charge. The daily run arms it at 06:00 of the billing
 * timezone for a reminder; `notifyCharge` re-arms it two hours later for the e-mail follow-up after a
 * push. Every hop is hours away, never days.
 */
export declare class ChargeNotifyScheduler extends Cron.Service<ChargeNotifySchedule> {
  group: 'charge-notify';

  expression: 'dynamic';

  maxRetries: 3;

  target: Cron.UseTarget<{
    handler: typeof chargeNotifyHandler;
    timeout: 60;
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

export async function chargeNotifyHandler(
  request: Cron.Incoming<ChargeNotifySchedule>,
  context: Service.Context<ChargeNotifyScheduler>
): Promise<void> {
  const event = request.event;
  const { db } = context;
  const now = Date.now();
  const notice = {
    config: notificationConfigFrom(context.variables),
    transport: notificationTransport(context.variables, globalThis.fetch, context.email),
    notify: context.chargeNotifyScheduler
  };

  if (event.stage === 'followup') {
    const { channels } = await followUpCharge(db, notice, event, now);

    console.info('Charge notify follow-up', { chargeId: event.chargeId, template: event.template, channels });
    return;
  }

  // A redelivery must not send the same reminder twice.
  const already = (await listEvents(db, event.chargeId, 'notice.sent')).some(
    (sent) => sent.payload['template'] === event.template && sent.payload['offsetDays'] === event.offsetDays
  );

  if (already) {
    console.info('Charge notify skipped', { chargeId: event.chargeId, reason: 'already_sent' });
    return;
  }

  const { channels } = await notifyCharge(db, notice, event.chargeId, event.template, now, event.offsetDays);

  console.info('Charge notify', { chargeId: event.chargeId, template: event.template, offsetDays: event.offsetDays, channels });
}
