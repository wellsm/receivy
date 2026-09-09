import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';
import type { String } from '@ez4/schema';
import type { Db } from '../database';
import type { EmailService } from '../email/service';
import { processDelivery } from './consumer';
import { notificationConfigFrom } from './planner';
import { notificationTransport } from './transport';

export declare class NotificationMessage implements Queue.Message {
  deliveryId: String.UUID;
}

export declare class NotificationQueue extends Queue.Unordered<NotificationMessage> {
  deadLetter: Queue.UseDeadLetter<{ maxAttempts: 5; retention: 20160 }>;

  backoff: Queue.UseBackoff<{ minDelay: 5; maxDelay: 300 }>;

  timeout: 120;

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof deliverNotification;
      concurrency: 2;
    }>
  ];

  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    NOTIFICATION_EMAIL_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_EMAIL_TRANSPORT', 'disabled'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
    RESEND_API_KEY: Environment.VariableOrValue<'RESEND_API_KEY', 'disabled'>;
    RESEND_FROM_EMAIL: Environment.VariableOrValue<'RESEND_FROM_EMAIL', 'disabled'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };
}

export async function deliverNotification(
  request: Queue.Incoming<NotificationMessage>,
  context: Service.Context<NotificationQueue>
): Promise<void> {
  const env = context.variables;
  const config = notificationConfigFrom(env);

  if (!config.secret || config.secret === 'disabled') {
    console.info('Notification delivery', { status: 'disabled' });
    return;
  }

  const transport = notificationTransport(env, globalThis.fetch, context.email);

  await processDelivery(context.db, transport, config, {
    deliveryId: request.message.deliveryId,
    attempt: request.attempt,
    maxAttempts: request.maxAttempts
  });
}
