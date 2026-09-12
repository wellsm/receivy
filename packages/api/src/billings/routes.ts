import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type {
  createBillingHandler,
  getBillingHandler,
  listBillingsHandler,
  patchBillingHandler,
  previewBillingHandler
} from '../billings/endpoints';

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
  }>
];
