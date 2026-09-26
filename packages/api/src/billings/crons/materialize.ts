import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { EmailService } from '../../common/services/email/service';
import type { Db } from '../../database';
import type { ChargeNotifyScheduler } from '../../notifications/schedulers/charge-notify';
import { noticeContext } from '../../notifications/services/context';
import type { WhatsappService } from '../../vendors/whatsapp/service';
import { materializeDueBillings, settleRegistered } from '../services/materialize';

/**
 * Daily at 05:00 UTC, past midnight in every Brazilian timezone: every active assinatura gets the
 * occurrences that came due, and their initial notices go out; then every registro pays what came due.
 * Creation and patches materialize inline, so this only covers "the day turned". Idempotent: a second
 * run finds nothing to do.
 */
export declare class BillingCron extends Cron.Service {
  expression: 'cron(0 5 * * ? *)';

  timezone: 'UTC';

  maxRetries: 1;

  target: Cron.UseTarget<{
    handler: typeof handler;
    timeout: 300;
  }>;

  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    whatsapp: Environment.Service<WhatsappService>;
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
    WHATSAPP_TRANSPORT: Environment.VariableOrValue<'WHATSAPP_TRANSPORT', 'disabled'>;
    EVOLUTION_API_URL: Environment.VariableOrValue<'EVOLUTION_API_URL', 'http://127.0.0.1:8080'>;
    EVOLUTION_API_KEY: Environment.VariableOrValue<'EVOLUTION_API_KEY', 'disabled'>;
    WHATSAPP_TEMPLATE_INITIAL: Environment.VariableOrValue<'WHATSAPP_TEMPLATE_INITIAL', 'receivy_charge_initial'>;
    WHATSAPP_TEMPLATE_REMINDER: Environment.VariableOrValue<'WHATSAPP_TEMPLATE_REMINDER', 'receivy_charge_reminder'>;
    WHATSAPP_TEMPLATE_MANUAL: Environment.VariableOrValue<'WHATSAPP_TEMPLATE_MANUAL', 'receivy_charge_manual'>;
  };
}

export async function handler(
  _request: Cron.Incoming<null>,
  { db, variables, email, whatsapp }: Service.Context<BillingCron>
): Promise<void> {
  const now = new Date();
  const notice = noticeContext({ variables, email, whatsapp });

  const materialized = await materializeDueBillings(db, notice, now);
  // After the sweep: the occurrence it just created is already paid, and this pays what came due since yesterday.
  const settled = await settleRegistered(db, now);

  // Counts only; never owner or recipient data.
  console.info('Billing cron', { materialized, settled });
}
