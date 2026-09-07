import type { Environment } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { Db } from "./database";

export declare class ApiProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    AUTH_JWT_SECRET: Environment.Variable<"AUTH_JWT_SECRET">;
    LOGIN_CODE_HASH_KEY: Environment.Variable<"LOGIN_CODE_HASH_KEY">;
    EMAIL_TRANSPORT: Environment.Variable<"EMAIL_TRANSPORT">;
    RESEND_API_KEY: Environment.Variable<"RESEND_API_KEY">;
    RESEND_FROM_EMAIL: Environment.Variable<"RESEND_FROM_EMAIL">;
    OAUTH_PROVIDERS_CONFIG_B64: Environment.Variable<"OAUTH_PROVIDERS_CONFIG_B64">;
    OAUTH_REDIRECT_ALLOW_LIST: Environment.Variable<"OAUTH_REDIRECT_ALLOW_LIST">;
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<"PUBLIC_LINK_HMAC_SECRET">;
  };
}
