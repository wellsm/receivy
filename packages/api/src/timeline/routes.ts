import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { contactLedgerHandler } from './endpoints/contact-ledger';

export type TimelineRoutes = [
  Http.UseRoute<{
    name: 'contactLedger';
    path: 'GET /contacts/{id}/ledger';
    authorizer: typeof sessionAuthorizer;
    handler: typeof contactLedgerHandler;
  }>
];
