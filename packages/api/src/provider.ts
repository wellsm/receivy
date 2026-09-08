import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from './database';
import type { EmailService } from './email/service';
import type { ProofFiles } from './storage';

export declare class ApiProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    proofFiles: Environment.Service<ProofFiles>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PROOF_STORAGE_MODE: Environment.VariableOrValue<'PROOF_STORAGE_MODE', 'disabled'>;
    PROOF_S3_BUCKET: Environment.VariableOrValue<'PROOF_S3_BUCKET', 'disabled'>;
    PROOF_LOCAL_DIRECTORY: Environment.VariableOrValue<'PROOF_LOCAL_DIRECTORY', 'disabled'>;
    PROOF_LOCAL_BASE_URL: Environment.VariableOrValue<'PROOF_LOCAL_BASE_URL', 'disabled'>;
    PROOF_LOCAL_SECRET: Environment.VariableOrValue<'PROOF_LOCAL_SECRET', 'disabled'>;
    AUTH_JWT_SECRET: Environment.Variable<'AUTH_JWT_SECRET'>;
    LOGIN_CODE_HASH_KEY: Environment.Variable<'LOGIN_CODE_HASH_KEY'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_API_KEY: Environment.Variable<'RESEND_API_KEY'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    OAUTH_PROVIDERS_CONFIG_B64: Environment.Variable<'OAUTH_PROVIDERS_CONFIG_B64'>;
    APPLE_CREDENTIAL_ENCRYPTION_KEY_B64: Environment.VariableOrValue<'APPLE_CREDENTIAL_ENCRYPTION_KEY_B64', 'disabled'>;
    OAUTH_REDIRECT_ALLOW_LIST: Environment.Variable<'OAUTH_REDIRECT_ALLOW_LIST'>;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };
}
