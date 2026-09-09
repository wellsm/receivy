import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type { acceptInviteHandler, createInviteHandler, publicInviteHandler, revokeInviteHandler } from '../invites/endpoints';

export type InviteRoutes = [
  Http.UseRoute<{
    name: 'createInvite';
    path: 'POST /billings/{id}/invite';
    authorizer: typeof sessionAuthorizer;
    handler: typeof createInviteHandler;
  }>,
  Http.UseRoute<{
    name: 'revokeInvite';
    path: 'DELETE /billings/{id}/invite';
    authorizer: typeof sessionAuthorizer;
    handler: typeof revokeInviteHandler;
  }>,
  Http.UseRoute<{ name: 'publicInvite'; path: 'GET /public/invites/{token}'; handler: typeof publicInviteHandler }>,
  Http.UseRoute<{
    name: 'acceptInvite';
    path: 'POST /invites/{token}/accept';
    authorizer: typeof sessionAuthorizer;
    handler: typeof acceptInviteHandler;
  }>
];
