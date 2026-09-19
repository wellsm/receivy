import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { cancelPlanHandler } from './endpoints/cancel';
import type { getPlanHandler } from './endpoints/get';
import type { planInvoicesHandler } from './endpoints/invoices';
import type { setupPlanPaymentMethodHandler } from './endpoints/payment-method';
import type { confirmPlanPaymentMethodHandler } from './endpoints/payment-method-confirm';
import type { resumePlanHandler } from './endpoints/resume';
import type { subscribePlanHandler } from './endpoints/subscribe';

export type PlanRoutes = [
  Http.UseRoute<{ name: 'getPlan'; path: 'GET /plan'; authorizer: typeof sessionAuthorizer; handler: typeof getPlanHandler }>,
  Http.UseRoute<{ name: 'subscribePlan'; path: 'POST /plan/subscribe'; authorizer: typeof sessionAuthorizer; handler: typeof subscribePlanHandler }>,
  Http.UseRoute<{ name: 'cancelPlan'; path: 'POST /plan/cancel'; authorizer: typeof sessionAuthorizer; handler: typeof cancelPlanHandler }>,
  Http.UseRoute<{ name: 'resumePlan'; path: 'POST /plan/resume'; authorizer: typeof sessionAuthorizer; handler: typeof resumePlanHandler }>,
  Http.UseRoute<{ name: 'setupPlanPaymentMethod'; path: 'POST /plan/payment-method'; authorizer: typeof sessionAuthorizer; handler: typeof setupPlanPaymentMethodHandler }>,
  Http.UseRoute<{ name: 'confirmPlanPaymentMethod'; path: 'POST /plan/payment-method/confirm'; authorizer: typeof sessionAuthorizer; handler: typeof confirmPlanPaymentMethodHandler }>,
  Http.UseRoute<{ name: 'planInvoices'; path: 'GET /plan/invoices'; authorizer: typeof sessionAuthorizer; handler: typeof planInvoicesHandler }>
];
