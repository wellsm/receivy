import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { String } from '@ez4/schema';
import { EventRepository } from '../../common/repositories/events';
import type { EmailService } from '../../common/services/email/service';
import type { Db } from '../../database';
import { noticeContext } from '../services/context';
import type { NoticeTemplate } from '../services/render';
import { notifyCharge } from '../services/send';

export type ChargeNotifySchedule = {
  chargeId: String.UUID;
  template: NoticeTemplate;
  offsetDays?: number;
};

/**
 * `charge:<id>:notify`: one dynamic schedule per charge. The daily run arms it at 06:00 of the billing
 * timezone for the reminder that is due; the notice goes out on the channels that rule asks for.
 */
export declare class ChargeNotifyScheduler extends Cron.Service<ChargeNotifySchedule> {
  group: 'charge-notify';

  expression: 'dynamic';

  maxRetries: 3;

  target: Cron.UseTarget<{
    handler: typeof handler;
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
    PAYMENT_METHOD_LINK: Environment.VariableOrValue<'PAYMENT_METHOD_LINK', 'disabled'>;
    PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_API_KEY: Environment.Variable<'RESEND_API_KEY'>;
    RESEND_FROM_EMAIL: Environment.VariableOrValue<'RESEND_FROM_EMAIL', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_API_ORIGIN: Environment.VariableOrValue<'PUBLIC_API_ORIGIN', 'http://127.0.0.1:3735/local-receivy-api'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };
}

export async function handler(
  request: Cron.Incoming<ChargeNotifySchedule>,
  { db, variables, email }: Service.Context<ChargeNotifyScheduler>
): Promise<void> {
  const event = request.event;
  const now = Date.now();
  const notice = noticeContext({ variables, email });

  // A redelivery must not send the same reminder twice.
  const already = (await EventRepository.list(db, event.chargeId, 'notice.sent')).some(
    (sent) => sent.payload.template === event.template && sent.payload.offsetDays === event.offsetDays
  );

  if (already) {
    console.info('Charge notify skipped', { chargeId: event.chargeId, reason: 'already_sent' });

    return;
  }

  const { channels } = await notifyCharge(db, notice, event.chargeId, event.template, now, event.offsetDays);

  console.info('Charge notify', { chargeId: event.chargeId, template: event.template, offsetDays: event.offsetDays, channels });
}
