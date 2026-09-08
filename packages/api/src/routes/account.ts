import type { Http } from '@ez4/gateway';
import type { deleteHandler, profileHandler } from '../account/endpoints';
import type { sessionAuthorizer } from '../authorizers/session';
export type AccountRoutes = [
  Http.UseRoute<{
    name: 'updateProfile';
    path: 'PATCH /account/profile';
    authorizer: typeof sessionAuthorizer;
    handler: typeof profileHandler;
  }>,
  Http.UseRoute<{ name: 'deleteAccount'; path: 'DELETE /account'; authorizer: typeof sessionAuthorizer; handler: typeof deleteHandler }>
];
