import { ArchitectureType, LogLevel, RuntimeType } from '@ez4/project';

const {
  APP_STAGE = 'dev',
  APP_DEBUG,
  EZ4_RAW_PG_DB_URL,
  AUTH_JWT_SECRET,
  LOGIN_CODE_HASH_KEY,
  EMAIL_TRANSPORT = 'disabled',
  RESEND_API_KEY = 'disabled',
  RESEND_FROM_EMAIL = 'disabled',
  OAUTH_REDIRECT_ALLOW_LIST = 'http://localhost:3000/auth/oauth/callback,receivy://auth/callback',
  PUBLIC_LINK_HMAC_SECRET,
  EZ4_TEST_PG_HOST = '127.0.0.1',
  EZ4_TEST_PG_PORT = '55434',
  EZ4_TEST_PG_USER = 'receivy',
  EZ4_TEST_PG_PASSWORD = 'receivy'
} = process.env;
const testStage = APP_STAGE === 'test';

/** @type {import("@ez4/project").ProjectOptions} */
export default {
  prefix: APP_STAGE,
  debugMode: APP_DEBUG === 'true',
  projectName: 'receivy',
  sourceFiles: [
    './src/api.ts',
    './src/billings/crons/materialize.ts',
    './src/notifications/crons/arm-notify.ts',
    './src/notifications/schedulers/charge-notify.ts',
    './src/proofs/schedulers/upload-expiry.ts'
  ],
  stateFile: {
    path: `${APP_STAGE}-deploy`,
    remote: true
  },
  serveOptions: {
    localPort: Number(process.env.API_LOCAL_PORT ?? 3735)
  },
  localOptions: {
    db:
      !testStage && EZ4_RAW_PG_DB_URL
        ? { connectionString: EZ4_RAW_PG_DB_URL }
        : {
            user: 'receivy',
            password: 'receivy',
            host: '127.0.0.1',
            port: 55434,
            database: 'receivy'
          }
  },
  testOptions: {
    db: {
      host: EZ4_TEST_PG_HOST,
      port: Number(EZ4_TEST_PG_PORT),
      user: EZ4_TEST_PG_USER,
      password: EZ4_TEST_PG_PASSWORD,
      database: 'receivy_tests'
    }
  },
  defaultOptions: {
    runtime: RuntimeType.Node24,
    architecture: ArchitectureType.Arm,
    logLevel: LogLevel.Information,
    logRetention: 30
  },
  deployOptions: {
    release: {
      version: new Date().toISOString().substring(0, 10),
      tagName: 'Version'
    }
  },
  tags: {
    Project: 'Receivy',
    Stage: APP_STAGE
  },
  variables: {
    APP_STAGE,
    APP_DEBUG,
    AUTH_JWT_SECRET,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? '900',
    LOGIN_CODE_HASH_KEY,
    EMAIL_TRANSPORT,
    MAILPIT_API_URL: process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8025',
    RESEND_API_KEY,
    RESEND_FROM_EMAIL,
    OAUTH_REDIRECT_ALLOW_LIST,
    GOOGLE_SIGNIN_ENABLED: process.env.GOOGLE_SIGNIN_ENABLED ?? 'false',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? 'disabled',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? 'disabled',
    APPLE_SIGNIN_ENABLED: process.env.APPLE_SIGNIN_ENABLED ?? 'false',
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID ?? 'disabled',
    APPLE_NATIVE_CLIENT_ID: process.env.APPLE_NATIVE_CLIENT_ID ?? 'disabled',
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID ?? 'disabled',
    APPLE_KEY_ID: process.env.APPLE_KEY_ID ?? 'disabled',
    APPLE_PRIVATE_KEY_B64: process.env.APPLE_PRIVATE_KEY_B64 ?? 'disabled',
    PUBLIC_LINK_HMAC_SECRET,
    NOTIFICATION_PUSH_TRANSPORT: process.env.NOTIFICATION_PUSH_TRANSPORT ?? 'disabled',
    EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN ?? 'disabled',
    PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000'
  }
};
