import type { Http } from '@ez4/gateway';
import type { deleteHandler, downloadHandler, exportHandler, profileHandler, revokeHandler, sessionsHandler } from '../account/endpoints';
import type { sessionAuthorizer } from '../authorizers/session';
export type AccountRoutes = [
  Http.UseRoute<{
    name: 'updateProfile';
    path: 'PATCH /account/profile';
    authorizer: typeof sessionAuthorizer;
    handler: typeof profileHandler;
  }>,
  Http.UseRoute<{
    name: 'listSessions';
    path: 'GET /account/sessions';
    authorizer: typeof sessionAuthorizer;
    handler: typeof sessionsHandler;
  }>,
  Http.UseRoute<{
    name: 'revokeSession';
    path: 'DELETE /account/sessions/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof revokeHandler;
  }>,
  Http.UseRoute<{ name: 'deleteAccount'; path: 'DELETE /account'; authorizer: typeof sessionAuthorizer; handler: typeof deleteHandler }>,
  Http.UseRoute<{
    name: 'exportAccount';
    path: 'POST /account/export';
    authorizer: typeof sessionAuthorizer;
    handler: typeof exportHandler;
  }>,
  Http.UseRoute<{
    name: 'downloadExport';
    path: 'POST /account/export/download';
    authorizer: typeof sessionAuthorizer;
    handler: typeof downloadHandler;
  }>
];
