import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { appleCallbackHandler } from './endpoints/apple-callback';
import type { nativeAppleExchangeHandler, nativeAppleStartHandler } from './endpoints/apple-native';
import type { completeAvatarUploadHandler, startAvatarUploadHandler } from './endpoints/avatar';
import type { deleteHandler } from './endpoints/delete-account';
import type { emailCodeHandler } from './endpoints/email-code';
import type { emailConfirmHandler } from './endpoints/email-confirm';
import type { googleCallbackHandler } from './endpoints/google-callback';
import type { logoutHandler } from './endpoints/logout';
import type { meHandler } from './endpoints/me';
import type { oauthExchangeHandler } from './endpoints/oauth-exchange';
import type { oauthProvidersHandler } from './endpoints/oauth-providers';
import type { oauthStartHandler } from './endpoints/oauth-start';
import type { profileHandler } from './endpoints/profile';
import type { refreshHandler } from './endpoints/refresh';
import type { deleteRemindersHandler } from './endpoints/reminders-delete';
import type { getRemindersHandler } from './endpoints/reminders-get';
import type { putRemindersHandler } from './endpoints/reminders-put';

export type UserRoutes = [
  Http.UseRoute<{ name: 'nativeAppleStart'; path: 'POST /auth/apple/native/start'; handler: typeof nativeAppleStartHandler }>,
  Http.UseRoute<{ name: 'nativeAppleExchange'; path: 'POST /auth/apple/native/exchange'; handler: typeof nativeAppleExchangeHandler }>,
  Http.UseRoute<{
    name: 'requestEmailCode';
    path: 'POST /auth/email/code';
    handler: typeof emailCodeHandler;
  }>,
  Http.UseRoute<{
    name: 'confirmEmailCode';
    path: 'POST /auth/email/confirm';
    handler: typeof emailConfirmHandler;
  }>,
  Http.UseRoute<{
    name: 'oauthProviders';
    path: 'GET /auth/oauth/providers';
    handler: typeof oauthProvidersHandler;
  }>,
  Http.UseRoute<{
    name: 'oauthStart';
    path: 'POST /auth/oauth/start';
    handler: typeof oauthStartHandler;
  }>,
  Http.UseRoute<{
    name: 'googleOauthCallback';
    path: 'GET /auth/google/callback';
    handler: typeof googleCallbackHandler;
  }>,
  Http.UseRoute<{
    name: 'appleOauthCallback';
    path: 'POST /auth/apple/callback';
    handler: typeof appleCallbackHandler;
  }>,
  Http.UseRoute<{
    name: 'oauthExchange';
    path: 'POST /auth/oauth/exchange';
    handler: typeof oauthExchangeHandler;
  }>,
  Http.UseRoute<{
    name: 'refreshSession';
    path: 'POST /auth/refresh';
    handler: typeof refreshHandler;
  }>,
  Http.UseRoute<{
    name: 'logout';
    path: 'POST /auth/logout';
    handler: typeof logoutHandler;
  }>,
  Http.UseRoute<{
    name: 'me';
    path: 'GET /auth/me';
    authorizer: typeof sessionAuthorizer;
    handler: typeof meHandler;
  }>,
  Http.UseRoute<{
    name: 'updateProfile';
    path: 'PATCH /account/profile';
    authorizer: typeof sessionAuthorizer;
    handler: typeof profileHandler;
  }>,
  Http.UseRoute<{
    name: 'startAvatarUpload';
    path: 'POST /account/avatar';
    authorizer: typeof sessionAuthorizer;
    handler: typeof startAvatarUploadHandler;
  }>,
  Http.UseRoute<{
    name: 'completeAvatarUpload';
    path: 'POST /account/avatar/complete';
    authorizer: typeof sessionAuthorizer;
    handler: typeof completeAvatarUploadHandler;
  }>,
  Http.UseRoute<{
    name: 'deleteAccount';
    path: 'DELETE /account';
    authorizer: typeof sessionAuthorizer;
    handler: typeof deleteHandler;
  }>,
  Http.UseRoute<{
    name: 'getReminders';
    path: 'GET /account/reminders';
    authorizer: typeof sessionAuthorizer;
    handler: typeof getRemindersHandler;
  }>,
  Http.UseRoute<{
    name: 'putReminders';
    path: 'PUT /account/reminders';
    authorizer: typeof sessionAuthorizer;
    handler: typeof putRemindersHandler;
  }>,
  Http.UseRoute<{
    name: 'clearReminders';
    path: 'DELETE /account/reminders';
    authorizer: typeof sessionAuthorizer;
    handler: typeof deleteRemindersHandler;
  }>
];
