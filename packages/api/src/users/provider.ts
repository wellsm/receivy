import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { EmailService } from '../common/services/email/service';
import type { Db } from '../database';
import type { ProofFiles } from '../storage';

export declare class UserProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    proofFiles: Environment.Service<ProofFiles>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    AUTH_JWT_SECRET: Environment.Variable<'AUTH_JWT_SECRET'>;
    LOGIN_CODE_HASH_KEY: Environment.Variable<'LOGIN_CODE_HASH_KEY'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    OAUTH_PROVIDERS_CONFIG_B64: Environment.Variable<'OAUTH_PROVIDERS_CONFIG_B64'>;
    OAUTH_GOOGLE_ENABLED: Environment.VariableOrValue<'OAUTH_GOOGLE_ENABLED', 'false'>;
    OAUTH_APPLE_ENABLED: Environment.VariableOrValue<'OAUTH_APPLE_ENABLED', 'false'>;
    OAUTH_REDIRECT_ALLOW_LIST: Environment.Variable<'OAUTH_REDIRECT_ALLOW_LIST'>;
  };
}
