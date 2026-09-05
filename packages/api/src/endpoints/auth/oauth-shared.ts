import type { Service } from "@ez4/common";
import type { ApiProvider } from "../../provider";
import { createOauthProviderClient, decodeOauthProviderConfig } from "../../auth/oauth-provider";
import type { OauthProvider } from "../../auth/oauth";

export function oauthDependencies(
  provider: OauthProvider,
  context: Service.Context<ApiProvider>,
) {
  const config = decodeOauthProviderConfig(
    context.variables.OAUTH_PROVIDERS_CONFIG_B64,
  );
  return {
    allowList: context.variables.OAUTH_REDIRECT_ALLOW_LIST
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    client: createOauthProviderClient(provider, config),
    config,
  };
}

export function appendOauthGrant(destination: string, grant: string | null): string {
  const url = new URL(destination);
  if (grant) url.searchParams.set("code", grant);
  else url.searchParams.set("error", "oauth");
  return url.toString();
}
