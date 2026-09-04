import type { Http } from "@ez4/gateway";
import type { sessionAuthorizer } from "../authorizers/session";
import type { emailCodeHandler } from "../endpoints/auth/email-code";
import type { emailConfirmHandler } from "../endpoints/auth/email-confirm";
import type { logoutHandler } from "../endpoints/auth/logout";
import type { meHandler } from "../endpoints/auth/me";
import type { refreshHandler } from "../endpoints/auth/refresh";

export type AuthRoutes = [
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
