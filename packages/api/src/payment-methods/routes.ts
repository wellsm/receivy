import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type {
  archivePaymentMethodHandler,
  createPaymentMethodHandler,
  defaultPaymentMethodHandler,
  editPaymentMethodHandler,
  listPaymentMethodsHandler
} from '../payment-methods/endpoints';

export type PaymentMethodRoutes = [
  Http.UseRoute<{
    name: 'listPaymentMethods';
    path: 'GET /payment-methods';
    authorizer: typeof sessionAuthorizer;
    handler: typeof listPaymentMethodsHandler;
  }>,
  Http.UseRoute<{
    name: 'createPaymentMethod';
    path: 'POST /payment-methods';
    authorizer: typeof sessionAuthorizer;
    handler: typeof createPaymentMethodHandler;
  }>,
  Http.UseRoute<{
    name: 'editPaymentMethod';
    path: 'PATCH /payment-methods/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof editPaymentMethodHandler;
  }>,
  Http.UseRoute<{
    name: 'defaultPaymentMethod';
    path: 'POST /payment-methods/{id}/default';
    authorizer: typeof sessionAuthorizer;
    handler: typeof defaultPaymentMethodHandler;
  }>,
  Http.UseRoute<{
    name: 'archivePaymentMethod';
    path: 'POST /payment-methods/{id}/archive';
    authorizer: typeof sessionAuthorizer;
    handler: typeof archivePaymentMethodHandler;
  }>
];
