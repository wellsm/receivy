import type { Http } from "@ez4/gateway";
import type { sessionAuthorizer } from "../authorizers/session";
import type { emailCodeHandler } from "../endpoints/auth/email-code";
import type { emailConfirmHandler } from "../endpoints/auth/email-confirm";
import type { logoutHandler } from "../endpoints/auth/logout";
import type { meHandler } from "../endpoints/auth/me";
import type { refreshHandler } from "../endpoints/auth/refresh";
import type { appleCallbackHandler } from "../endpoints/auth/apple-callback";
import type { googleCallbackHandler } from "../endpoints/auth/google-callback";
import type { oauthExchangeHandler } from "../endpoints/auth/oauth-exchange";
import type { oauthProvidersHandler } from "../endpoints/auth/oauth-providers";
import type { oauthStartHandler } from "../endpoints/auth/oauth-start";
import type { nativeAppleStartHandler, nativeAppleExchangeHandler } from "../endpoints/auth/apple-native";

export type AuthRoutes = [
  Http.UseRoute<{ name: "nativeAppleStart"; path: "POST /auth/apple/native/start"; handler: typeof nativeAppleStartHandler }>,
  Http.UseRoute<{ name: "nativeAppleExchange"; path: "POST /auth/apple/native/exchange"; handler: typeof nativeAppleExchangeHandler }>,
  Http.UseRoute<{
    name: "requestEmailCode";
    path: "POST /auth/email/code";
    handler: typeof emailCodeHandler;
  }>,
  Http.UseRoute<{
    name: "confirmEmailCode";
    path: "POST /auth/email/confirm";
    handler: typeof emailConfirmHandler;
  }>,
  Http.UseRoute<{
    name: "oauthProviders";
    path: "GET /auth/oauth/providers";
    handler: typeof oauthProvidersHandler;
  }>,
  Http.UseRoute<{
    name: "oauthStart";
    path: "POST /auth/oauth/start";
    handler: typeof oauthStartHandler;
  }>,
  Http.UseRoute<{
    name: "googleOauthCallback";
    path: "GET /auth/google/callback";
    handler: typeof googleCallbackHandler;
  }>,
  Http.UseRoute<{
    name: "appleOauthCallback";
    path: "POST /auth/apple/callback";
    handler: typeof appleCallbackHandler;
  }>,
  Http.UseRoute<{
    name: "oauthExchange";
    path: "POST /auth/oauth/exchange";
    handler: typeof oauthExchangeHandler;
  }>,
  Http.UseRoute<{
    name: "refreshSession";
    path: "POST /auth/refresh";
    handler: typeof refreshHandler;
  }>,
  Http.UseRoute<{
    name: "logout";
    path: "POST /auth/logout";
    handler: typeof logoutHandler;
  }>,
  Http.UseRoute<{
    name: "me";
    path: "GET /auth/me";
    authorizer: typeof sessionAuthorizer;
    handler: typeof meHandler;
  }>,
];
