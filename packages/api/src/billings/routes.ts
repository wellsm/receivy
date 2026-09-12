import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { createBillingHandler } from './endpoints/create';
import type { getBillingHandler } from './endpoints/get';
import type { listBillingsHandler } from './endpoints/list';
import type { patchBillingHandler } from './endpoints/patch';
import type { previewBillingHandler } from './endpoints/preview';
import type { resolveGuestHandler } from './endpoints/resolve-guest';

export type BillingRoutes = [
  Http.UseRoute<{
    name: 'createBilling';
    path: 'POST /billings';
    authorizer: typeof sessionAuthorizer;
    handler: typeof createBillingHandler;
  }>,
  Http.UseRoute<{ name: 'listBillings'; path: 'GET /billings'; authorizer: typeof sessionAuthorizer; handler: typeof listBillingsHandler }>,
  Http.UseRoute<{
    name: 'getBilling';
    path: 'GET /billings/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof getBillingHandler;
  }>,
  Http.UseRoute<{
    name: 'previewBilling';
    path: 'GET /billings/{id}/preview';
    authorizer: typeof sessionAuthorizer;
    handler: typeof previewBillingHandler;
  }>,
  Http.UseRoute<{
    name: 'patchBilling';
    path: 'PATCH /billings/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof patchBillingHandler;
  }>,
  Http.UseRoute<{
    name: 'resolveBillingGuest';
    path: 'POST /billings/{id}/guests/{guestId}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof resolveGuestHandler;
  }>
];
