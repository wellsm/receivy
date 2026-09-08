import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type { personLedgerHandler, timelineHandler } from '../timeline/endpoints';

export type TimelineRoutes = [
  Http.UseRoute<{ name: 'timeline'; path: 'GET /timeline'; authorizer: typeof sessionAuthorizer; handler: typeof timelineHandler }>,
  Http.UseRoute<{
    name: 'personLedger';
    path: 'GET /people/{id}/ledger';
    authorizer: typeof sessionAuthorizer;
    handler: typeof personLedgerHandler;
  }>
];
