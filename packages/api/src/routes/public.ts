import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type { createPublicLinkHandler, publicChargeHandler, revokePublicLinkHandler, rotatePublicLinkHandler } from '../public/endpoints';

export type PublicRoutes = [
  Http.UseRoute<{
    name: 'createPublicLink';
    path: 'POST /charges/{id}/public-link';
    authorizer: typeof sessionAuthorizer;
    handler: typeof createPublicLinkHandler;
  }>,
  Http.UseRoute<{
    name: 'rotatePublicLink';
    path: 'POST /charges/{id}/public-link/rotate';
    authorizer: typeof sessionAuthorizer;
    handler: typeof rotatePublicLinkHandler;
  }>,
  Http.UseRoute<{
    name: 'revokePublicLink';
    path: 'DELETE /charges/{id}/public-link';
    authorizer: typeof sessionAuthorizer;
    handler: typeof revokePublicLinkHandler;
  }>,
  Http.UseRoute<{ name: 'publicCharge'; path: 'GET /public/charges/{token}'; handler: typeof publicChargeHandler }>
];
