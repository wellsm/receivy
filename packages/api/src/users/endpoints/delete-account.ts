import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';

declare class DeleteRequest implements Http.Request {
  identity: SessionIdentity;
  body: { confirmation: String.Max<20> };
}

declare class DeleteResponse implements Http.Response {
  status: 200;
  body: { deleted: boolean };
}

export async function deleteHandler({ identity, body }: DeleteRequest, { accounts }: Service.Context<UserProvider>): Promise<DeleteResponse> {
  return { status: 200, body: await accounts.erase(identity.userId, body.confirmation) };
}
