import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { publicChargeHandler } from './endpoints/charge';
import type { createPublicLinkHandler } from './endpoints/create-link';
import type { revokePublicLinkHandler } from './endpoints/revoke-link';
import type { rotatePublicLinkHandler } from './endpoints/rotate-link';

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
