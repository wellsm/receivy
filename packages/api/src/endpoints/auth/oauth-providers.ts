import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { ApiProvider } from "../../provider";
import { decodeOauthProviderConfig } from "../../auth/oauth-provider";

declare class OauthProvidersRequest implements Http.Request {}

declare class OauthProvidersResponse implements Http.Response {
  status: 200;
  body: { apple: boolean; google: boolean };
}

export async function oauthProvidersHandler(
  _request: OauthProvidersRequest,
  context: Service.Context<ApiProvider>,
): Promise<OauthProvidersResponse> {
  const config = decodeOauthProviderConfig(
    context.variables.OAUTH_PROVIDERS_CONFIG_B64,
  );
  return {
    status: 200,
    body: { apple: !!config.apple, google: !!config.google },
  };
}
