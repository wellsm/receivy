import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { contactLedgerHandler } from './endpoints/contact-ledger';
import type { timelineHandler } from './endpoints/timeline';

export type TimelineRoutes = [
  Http.UseRoute<{ name: 'timeline'; path: 'GET /timeline'; authorizer: typeof sessionAuthorizer; handler: typeof timelineHandler }>,
  Http.UseRoute<{
    name: 'contactLedger';
    path: 'GET /contacts/{id}/ledger';
    authorizer: typeof sessionAuthorizer;
    handler: typeof contactLedgerHandler;
  }>
];
