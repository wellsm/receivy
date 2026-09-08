import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type { cancelChargeHandler, getChargeHandler, manualPaymentHandler } from '../charges/endpoints';

export type ChargeRoutes = [
  Http.UseRoute<{ name: 'getCharge'; path: 'GET /charges/{id}'; authorizer: typeof sessionAuthorizer; handler: typeof getChargeHandler }>,
  Http.UseRoute<{
    name: 'cancelCharge';
    path: 'POST /charges/{id}/cancel';
    authorizer: typeof sessionAuthorizer;
    handler: typeof cancelChargeHandler;
  }>,
  Http.UseRoute<{
    name: 'manualPayment';
    path: 'POST /charges/{id}/payments';
    authorizer: typeof sessionAuthorizer;
    handler: typeof manualPaymentHandler;
  }>
];
