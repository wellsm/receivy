import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { appleKeyAvailable } from '../../auth/apple-credentials';
import { appleConfigurationAvailable, decodeOauthProviderConfig } from '../../auth/oauth-provider';
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
  const config = decodeOauthProviderConfig(context.variables.OAUTH_PROVIDERS_CONFIG_B64);
  return {
    status: 200,
    body: {
      apple: appleConfigurationAvailable(config.apple) && appleKeyAvailable(context.variables.APPLE_CREDENTIAL_ENCRYPTION_KEY_B64),
      appleNative:
        !!config.apple?.nativeClientId &&
        appleConfigurationAvailable(config.apple) &&
        appleKeyAvailable(context.variables.APPLE_CREDENTIAL_ENCRYPTION_KEY_B64),
      google: !!config.google
    }
  };
}
