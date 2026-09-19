import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';

export declare class WebhookProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PAYMENT_METHOD_LINK: Environment.VariableOrValue<'PAYMENT_METHOD_LINK', 'disabled'>;
    PAYMENT_CREDENTIAL_KEY_B64: Environment.VariableOrValue<'PAYMENT_CREDENTIAL_KEY_B64', 'disabled'>;
    PLAN_BILLING: Environment.VariableOrValue<'PLAN_BILLING', 'disabled'>;
    STRIPE_SECRET_KEY: Environment.VariableOrValue<'STRIPE_SECRET_KEY', 'disabled'>;
    STRIPE_WEBHOOK_SECRET: Environment.VariableOrValue<'STRIPE_WEBHOOK_SECRET', 'disabled'>;
    STRIPE_PRICE_BASIC: Environment.VariableOrValue<'STRIPE_PRICE_BASIC', 'disabled'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_API_KEY: Environment.Variable<'RESEND_API_KEY'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    MAILPIT_API_URL: Environment.VariableOrValue<'MAILPIT_API_URL', 'http://127.0.0.1:8025'>;
  };
}
