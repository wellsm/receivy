import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { archiveContactHandler } from './endpoints/archive';
import type { createContactHandler } from './endpoints/create';
import type { getContactHandler } from './endpoints/get';
import type { listContactsHandler } from './endpoints/list';
import type { updateContactHandler } from './endpoints/update';

export type ContactRoutes = [
  Http.UseRoute<{
    name: 'getContact';
    path: 'GET /contacts/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof getContactHandler;
  }>,
  Http.UseRoute<{ name: 'listContacts'; path: 'GET /contacts'; authorizer: typeof sessionAuthorizer; handler: typeof listContactsHandler }>,
  Http.UseRoute<{
    name: 'createContact';
    path: 'POST /contacts';
    authorizer: typeof sessionAuthorizer;
    handler: typeof createContactHandler;
  }>,
  Http.UseRoute<{
    name: 'updateContact';
    path: 'PATCH /contacts/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof updateContactHandler;
  }>,
  Http.UseRoute<{
    name: 'archiveContact';
    path: 'POST /contacts/{id}/archive';
    authorizer: typeof sessionAuthorizer;
    handler: typeof archiveContactHandler;
  }>
];
