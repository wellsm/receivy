import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { EmailService } from '../common/services/email/service';
import type { Db } from '../database';
import type { AvatarFiles, ProofFiles } from '../storage';

export declare class UserProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    email: Environment.Service<EmailService>;
    avatarFiles: Environment.Service<AvatarFiles>;
    // Erasing an account still deletes the proof files the person sent.
    proofFiles: Environment.Service<ProofFiles>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    AUTH_JWT_SECRET: Environment.Variable<'AUTH_JWT_SECRET'>;
    LOGIN_CODE_HASH_KEY: Environment.Variable<'LOGIN_CODE_HASH_KEY'>;
    EMAIL_TRANSPORT: Environment.Variable<'EMAIL_TRANSPORT'>;
    RESEND_FROM_EMAIL: Environment.Variable<'RESEND_FROM_EMAIL'>;
    OAUTH_REDIRECT_ALLOW_LIST: Environment.Variable<'OAUTH_REDIRECT_ALLOW_LIST'>;
    PUBLIC_WEB_ORIGIN: Environment.Variable<'PUBLIC_WEB_ORIGIN'>;
    GOOGLE_SIGNIN_ENABLED: Environment.Variable<'GOOGLE_SIGNIN_ENABLED'>;
    GOOGLE_CLIENT_ID: Environment.Variable<'GOOGLE_CLIENT_ID'>;
    GOOGLE_CLIENT_SECRET: Environment.Variable<'GOOGLE_CLIENT_SECRET'>;
    APPLE_SIGNIN_ENABLED: Environment.Variable<'APPLE_SIGNIN_ENABLED'>;
    APPLE_CLIENT_ID: Environment.Variable<'APPLE_CLIENT_ID'>;
    APPLE_NATIVE_CLIENT_ID: Environment.Variable<'APPLE_NATIVE_CLIENT_ID'>;
    APPLE_TEAM_ID: Environment.Variable<'APPLE_TEAM_ID'>;
    APPLE_KEY_ID: Environment.Variable<'APPLE_KEY_ID'>;
    APPLE_PRIVATE_KEY_B64: Environment.Variable<'APPLE_PRIVATE_KEY_B64'>;
  };
}
