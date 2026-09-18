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
  };
}
