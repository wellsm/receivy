import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { InviteProvider } from '../provider';
import { revokeInvite } from '../repositories/invite';

declare class BillingRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class EmptyResponse implements Http.Response {
  status: 204;
}

export async function revokeInviteHandler(request: BillingRequest, context: Service.Context<InviteProvider>): Promise<EmptyResponse> {
  await revokeInvite(context.db, request.identity.userId, request.parameters.id);

  return { status: 204 };
}
