import type { Service } from '@ez4/common';
import { appleKeyAvailable, bindAppleCredential, journalAppleCredential } from '../../auth/apple-credentials';
import type { OauthProvider } from '../../auth/oauth';
import { createOauthProviderClient, decodeOauthProviderConfig } from '../../auth/oauth-provider';
import type { ApiProvider } from '../../provider';

export function oauthDependencies(provider: OauthProvider, context: Service.Context<ApiProvider>, native = false) {
  const config = decodeOauthProviderConfig(context.variables.OAUTH_PROVIDERS_CONFIG_B64);
  const key = context.variables.APPLE_CREDENTIAL_ENCRYPTION_KEY_B64;
  return {
    allowList: context.variables.OAUTH_REDIRECT_ALLOW_LIST.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    client: createOauthProviderClient(
      provider,
      config,
      fetch,
      appleKeyAvailable(key)
        ? {
            retain: (clientId, token) => journalAppleCredential(context.db, key, clientId, token),
            bind: (id, subject) => bindAppleCredential(context.db, key, id, subject)
          }
        : undefined,
      native
    ),
    config
  };
}

export function appendOauthGrant(destination: string, grant: string | null): string {
  const url = new URL(destination);
  if (grant) url.searchParams.set('code', grant);
  else url.searchParams.set('error', 'oauth');
  return url.toString();
}
