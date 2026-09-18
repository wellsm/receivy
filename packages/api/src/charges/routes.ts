import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { cancelChargeHandler } from './endpoints/cancel';
import type { getChargeHandler } from './endpoints/get';
import type { listChargesHandler } from './endpoints/list';
import type { setChargeNotifyHandler } from './endpoints/notify';
import type { payChargeHandler } from './endpoints/pay';
import type { reopenChargeHandler } from './endpoints/reopen';

export type ChargeRoutes = [
  Http.UseRoute<{
    name: 'listCharges';
    path: 'GET /charges';
    authorizer: typeof sessionAuthorizer;
    handler: typeof listChargesHandler;
  }>,
  Http.UseRoute<{
    name: 'getCharge';
    path: 'GET /charges/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof getChargeHandler;
  }>,
  Http.UseRoute<{
    name: 'cancelCharge';
    path: 'POST /charges/{id}/cancel';
    authorizer: typeof sessionAuthorizer;
    handler: typeof cancelChargeHandler;
  }>,
  Http.UseRoute<{
    name: 'payCharge';
    path: 'POST /charges/{id}/pay';
    authorizer: typeof sessionAuthorizer;
    handler: typeof payChargeHandler;
  }>,
  Http.UseRoute<{
    name: 'reopenCharge';
    path: 'POST /charges/{id}/reopen';
    authorizer: typeof sessionAuthorizer;
    handler: typeof reopenChargeHandler;
  }>,
  Http.UseRoute<{
    name: 'setChargeNotify';
    path: 'PUT /charges/{id}/notify';
    authorizer: typeof sessionAuthorizer;
    handler: typeof setChargeNotifyHandler;
  }>
];
