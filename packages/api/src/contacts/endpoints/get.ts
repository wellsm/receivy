import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { Contact } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ContactProvider } from '../provider';
import { getContact } from '../repositories/contact';

declare class GetRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class GetResponse implements Http.Response {
  status: 200;
  body: Contact;
}

export async function getContactHandler(request: GetRequest, context: Service.Context<ContactProvider>): Promise<GetResponse> {
  return { status: 200, body: await getContact(context.db, request.identity.userId, request.parameters.id) };
}
