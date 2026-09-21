import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { publicChargeHandler } from './endpoints/charge';
import type { chargeByLinkHandler } from './endpoints/charge-by-link';
import type { createPublicLinkHandler } from './endpoints/create-link';
import type { optInHandler } from './endpoints/opt-in';
import type { optOutHandler } from './endpoints/opt-out';
import type { providerReturnHandler } from './endpoints/provider-return';
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
    name: 'chargeByLink';
    path: 'GET /charges/by-link/{token}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof chargeByLinkHandler;
  }>,
  Http.UseRoute<{ name: 'publicCharge'; path: 'GET /public/charges/{token}'; handler: typeof publicChargeHandler }>,
  Http.UseRoute<{ name: 'providerReturn'; path: 'POST /public/charges/{token}/provider-return'; handler: typeof providerReturnHandler }>,
  Http.UseRoute<{ name: 'noticeOptOut'; path: 'POST /public/notices/opt-out/{token}'; handler: typeof optOutHandler }>,
  Http.UseRoute<{ name: 'noticeOptIn'; path: 'DELETE /public/notices/opt-out/{token}'; handler: typeof optInHandler }>
];
