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
  OAUTH_PROVIDERS_CONFIG_B64 = 'disabled',
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
    './src/billings/queue.ts',
    './src/billings/cron.ts',
    './src/notifications/queue.ts',
    './src/notifications/cron.ts',
    './src/proofs/queue.ts',
    './src/proofs/cron.ts'
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
    LOGIN_CODE_HASH_KEY,
    EMAIL_TRANSPORT,
    RESEND_API_KEY,
    RESEND_FROM_EMAIL,
    OAUTH_PROVIDERS_CONFIG_B64,
    OAUTH_REDIRECT_ALLOW_LIST,
    PUBLIC_LINK_HMAC_SECRET,
    NOTIFICATION_EMAIL_TRANSPORT: process.env.NOTIFICATION_EMAIL_TRANSPORT ?? 'disabled',
    NOTIFICATION_PUSH_TRANSPORT: process.env.NOTIFICATION_PUSH_TRANSPORT ?? 'disabled',
    EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN ?? 'disabled',
    PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000',
    PROOF_STORAGE_MODE: process.env.PROOF_STORAGE_MODE ?? 'disabled',
    PROOF_S3_BUCKET: process.env.PROOF_S3_BUCKET ?? 'disabled',
    PROOF_LOCAL_DIRECTORY: process.env.PROOF_LOCAL_DIRECTORY ?? 'disabled',
    PROOF_LOCAL_BASE_URL: process.env.PROOF_LOCAL_BASE_URL ?? 'disabled',
    PROOF_LOCAL_SECRET: process.env.PROOF_LOCAL_SECRET ?? 'disabled',
    EMAIL_FILE_DIRECTORY: process.env.EMAIL_FILE_DIRECTORY ?? '.ez4/emails'
  }
};
