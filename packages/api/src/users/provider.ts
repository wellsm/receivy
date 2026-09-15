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
    OAUTH_REDIRECT_ALLOW_LIST: Environment.Variable<'OAUTH_REDIRECT_ALLOW_LIST'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    GOOGLE_SIGNIN_ENABLED: Environment.VariableOrValue<'GOOGLE_SIGNIN_ENABLED', 'false'>;
    GOOGLE_CLIENT_ID: Environment.VariableOrValue<'GOOGLE_CLIENT_ID', 'disabled'>;
    GOOGLE_CLIENT_SECRET: Environment.VariableOrValue<'GOOGLE_CLIENT_SECRET', 'disabled'>;
    APPLE_SIGNIN_ENABLED: Environment.VariableOrValue<'APPLE_SIGNIN_ENABLED', 'false'>;
    APPLE_CLIENT_ID: Environment.VariableOrValue<'APPLE_CLIENT_ID', 'disabled'>;
    APPLE_NATIVE_CLIENT_ID: Environment.VariableOrValue<'APPLE_NATIVE_CLIENT_ID', 'disabled'>;
    APPLE_TEAM_ID: Environment.VariableOrValue<'APPLE_TEAM_ID', 'disabled'>;
    APPLE_KEY_ID: Environment.VariableOrValue<'APPLE_KEY_ID', 'disabled'>;
    APPLE_PRIVATE_KEY_B64: Environment.VariableOrValue<'APPLE_PRIVATE_KEY_B64', 'disabled'>;
  };
}
