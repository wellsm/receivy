import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { InviteAcceptResult } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { InviteProvider } from '../provider';

declare class AcceptRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { token: String.Max<200> };
}

declare class AcceptResponse implements Http.Response {
  status: 200;
  body: InviteAcceptResult;
}

export async function acceptInviteHandler({ identity, parameters }: AcceptRequest, { invites }: Service.Context<InviteProvider>): Promise<AcceptResponse> {
  return { status: 200, body: await invites.accept(identity.userId, parameters.token) };
}
