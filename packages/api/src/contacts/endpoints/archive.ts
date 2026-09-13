import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ContactProvider } from '../provider';
import { ContactRepository } from '../repositories/contact';

declare class ArchiveRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ArchiveResponse implements Http.Response {
  status: 204;
}

export async function archiveContactHandler(request: ArchiveRequest, { db }: Service.Context<ContactProvider>): Promise<ArchiveResponse> {
  await ContactRepository.archive(db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
