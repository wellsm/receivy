import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingInvite } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { InviteProvider } from '../provider';

declare class BillingRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class InviteResponse implements Http.Response {
  status: 200;
  body: BillingInvite;
}

export async function createInviteHandler({ identity, parameters }: BillingRequest, { invites }: Service.Context<InviteProvider>): Promise<InviteResponse> {
  return { status: 200, body: await invites.create(identity.userId, parameters.id) };
}
