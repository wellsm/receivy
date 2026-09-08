import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { normalizePerson, type PeoplePage, type Person, type PersonInput } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { archivePerson, getPerson, listPeople, savePerson } from './repository';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: { cursor?: String.UUID; archived?: boolean; search?: String.Max<254> };
}
declare class ListResponse implements Http.Response {
  status: 200;
  body: PeoplePage;
}

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  body: { name: String.Max<120>; email?: String.Max<254>; phone?: String.Max<40> };
}
declare class UpdateRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: { name: String.Max<120>; email?: String.Max<254>; phone?: String.Max<40> };
}
declare class ArchiveRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class CreateResponse implements Http.Response {
  status: 201;
  body: Person;
}
declare class UpdateResponse implements Http.Response {
  status: 200;
  body: Person;
}
declare class ArchiveResponse implements Http.Response {
  status: 204;
}

function parse(input: PersonInput): PersonInput {
  try {
    return normalizePerson(input);
  } catch (error) {
    throw new HttpBadRequestError(error instanceof Error ? error.message : 'Contato inválido.');
  }
}

export async function listPeopleHandler(request: ListRequest, context: Service.Context<ApiProvider>): Promise<ListResponse> {
  return {
    status: 200,
    body: await listPeople(context.db, request.identity.userId, request.query.cursor, request.query.archived, request.query.search)
  };
}
export async function createPersonHandler(request: CreateRequest, context: Service.Context<ApiProvider>): Promise<CreateResponse> {
  return { status: 201, body: await savePerson(context.db, request.identity.userId, parse(request.body)) };
}
export async function updatePersonHandler(request: UpdateRequest, context: Service.Context<ApiProvider>): Promise<UpdateResponse> {
  return { status: 200, body: await savePerson(context.db, request.identity.userId, parse(request.body), request.parameters.id) };
}
export async function archivePersonHandler(request: ArchiveRequest, context: Service.Context<ApiProvider>): Promise<ArchiveResponse> {
  await archivePerson(context.db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
export async function getPersonHandler(request: ArchiveRequest, context: Service.Context<ApiProvider>): Promise<UpdateResponse> {
  return { status: 200, body: await getPerson(context.db, request.identity.userId, request.parameters.id) };
}
