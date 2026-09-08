import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import type { EmailService } from '../email/service';
import { notificationTransport } from './transport';
import { runNotifications } from './worker';
export declare class NotificationScheduler extends Cron.Service {
  expression: 'cron(* * * * ? *)';
  timezone: 'UTC';
  maxRetries: 3;
  target: Cron.UseTarget<{
    handler: typeof notificationJobHandler;
    timeout: 300;
  }>;
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
export async function notificationJobHandler(
  _request: Cron.Incoming<null>,
  context: Service.Context<NotificationScheduler>
): Promise<void> {
  const env = context.variables;
  const result = await runNotifications(context.db, notificationTransport(env, globalThis.fetch, context.email), {
    publicOrigin: env.PUBLIC_WEB_ORIGIN,
    secret: env.PUBLIC_LINK_HMAC_SECRET,
    from: env.RESEND_FROM_EMAIL,
    pushAvailable: env.NOTIFICATION_PUSH_TRANSPORT === 'expo'
  });
  console.info('Notification worker', result); // Counts/status only; never provider payload or recipients.
}
