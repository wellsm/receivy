import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';
import type { Db } from '../database';
import { drainAppleRevocations } from './apple-credentials';
import { createAppleRevoker, decodeOauthProviderConfig } from './oauth-provider';

export declare class AppleRevocationScheduler extends Cron.Service {
  expression: 'cron(* * * * ? *)';
  timezone: 'UTC';
  maxRetries: 3;
  target: Cron.UseTarget<{ handler: typeof appleRevocationJobHandler; timeout: 300 }>;
  services: { db: Environment.Service<Db>; variables: Environment.ServiceVariables };
  variables: {
    APPLE_CREDENTIAL_ENCRYPTION_KEY_B64: Environment.VariableOrValue<'APPLE_CREDENTIAL_ENCRYPTION_KEY_B64', 'disabled'>;
    OAUTH_PROVIDERS_CONFIG_B64: Environment.VariableOrValue<'OAUTH_PROVIDERS_CONFIG_B64', 'disabled'>;
  };
}
export async function appleRevocationJobHandler(
  _request: Cron.Incoming<null>,
  context: Service.Context<AppleRevocationScheduler>
): Promise<void> {
  const result = await drainAppleRevocations(
    context.db,
    context.variables.APPLE_CREDENTIAL_ENCRYPTION_KEY_B64,
    createAppleRevoker(decodeOauthProviderConfig(context.variables.OAUTH_PROVIDERS_CONFIG_B64))
  );
  console.info(JSON.stringify({ event: 'apple_revocations', ...result }));
}
