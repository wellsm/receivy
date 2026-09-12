import type { Service } from '@ez4/common';
import type { OauthProvider } from '../../auth/oauth';
import { createOauthProviderClient, oauthProviderConfigFrom } from '../../auth/oauth-provider';
import type { ApiProvider } from '../../provider';

export function oauthDependencies(provider: OauthProvider, context: Service.Context<ApiProvider>, native = false) {
  const config = oauthProviderConfigFrom(context.variables);
  return {
    allowList: context.variables.OAUTH_REDIRECT_ALLOW_LIST.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    client: createOauthProviderClient(provider, config, fetch, native),
    config
  };
}

export function appendOauthGrant(destination: string, grant: string | null): string {
  const url = new URL(destination);
  if (grant) url.searchParams.set('code', grant);
  else url.searchParams.set('error', 'oauth');
  return url.toString();
}
