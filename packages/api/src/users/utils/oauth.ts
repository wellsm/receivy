import type { Service } from '@ez4/common';
import type { UserProvider } from '../provider';
import type { OauthProvider } from '../services/oauth';
import { createOauthProviderClient, oauthProviderConfigFrom } from '../services/oauth-provider';

export function oauthDependencies(
  provider: OauthProvider,
  { variables }: Pick<Service.Context<UserProvider>, 'variables'>,
  native = false
) {
  const config = oauthProviderConfigFrom(variables);

  return {
    allowList: variables.OAUTH_REDIRECT_ALLOW_LIST.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    client: createOauthProviderClient(provider, config, fetch, native),
    config
  };
}

export function appendOauthGrant(destination: string, grant: string | null): string {
  const url = new URL(destination);

  if (grant) {
    url.searchParams.set('code', grant);
  }
  else {
    url.searchParams.set('error', 'oauth');
  }

  return url.toString();
}
