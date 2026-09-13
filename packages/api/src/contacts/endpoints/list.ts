import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ContactsPage } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ContactProvider } from '../provider';
import { ContactRepository } from '../repositories/contact';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  // The `recent` order pages with an opaque base64url keyset cursor; the default order still sends a plain id.
  query: { cursor?: String.Max<500>; archived?: boolean; search?: String.Max<254>; sort?: 'recent' };
}

declare class ListResponse implements Http.Response {
  status: 200;
  body: ContactsPage;
}

export async function listContactsHandler(request: ListRequest, { db }: Service.Context<ContactProvider>): Promise<ListResponse> {
  return {
    status: 200,
    body: await ContactRepository.list(
      db,
      request.identity.userId,
      request.query.cursor,
      request.query.archived,
      request.query.search,
      request.query.sort
    )
  };
}
