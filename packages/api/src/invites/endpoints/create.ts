import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingInvite } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { InviteProvider } from '../provider';
import { createInvite } from '../repositories/invite';

declare class BillingRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class InviteResponse implements Http.Response {
  status: 200;
  body: BillingInvite;
}

export async function createInviteHandler(request: BillingRequest, context: Service.Context<InviteProvider>): Promise<InviteResponse> {
  const body = await createInvite(
    context.db,
    request.identity.userId,
    request.parameters.id,
    context.variables.PUBLIC_LINK_HMAC_SECRET,
    context.variables.PUBLIC_WEB_ORIGIN
  );

  return { status: 200, body };
}
