import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { UserProvider } from '../provider';
import { appleConfigurationAvailable, oauthProviderConfigFrom } from '../services/oauth-provider';

declare class OauthProvidersRequest implements Http.Request {}

declare class OauthProvidersResponse implements Http.Response {
  status: 200;
  body: { apple: boolean; appleNative: boolean; google: boolean };
}

export async function oauthProvidersHandler(
  _: OauthProvidersRequest,
  { variables }: Service.Context<UserProvider>
): Promise<OauthProvidersResponse> {
  const config = oauthProviderConfigFrom(variables);
  const apple = appleConfigurationAvailable(config.apple);

  return {
    status: 200,
    body: {
      apple,
      appleNative: apple && !!config.apple?.nativeClientId,
      google: !!config.google
    }
  };
}
