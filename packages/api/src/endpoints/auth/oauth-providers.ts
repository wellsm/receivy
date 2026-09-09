import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { appleConfigurationAvailable, oauthProviderConfigFrom } from '../../auth/oauth-provider';
import type { ApiProvider } from '../../provider';

declare class OauthProvidersRequest implements Http.Request {}

declare class OauthProvidersResponse implements Http.Response {
  status: 200;
  body: { apple: boolean; appleNative: boolean; google: boolean };
}

export async function oauthProvidersHandler(
  _request: OauthProvidersRequest,
  context: Service.Context<ApiProvider>
): Promise<OauthProvidersResponse> {
  const config = oauthProviderConfigFrom(context.variables);
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
