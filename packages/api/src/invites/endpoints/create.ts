import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingInvite } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { InviteProvider } from '../provider';
import { createInvite } from '../services/links';

declare class BillingRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class InviteResponse implements Http.Response {
  status: 200;
  body: BillingInvite;
}

export async function createInviteHandler(
  request: BillingRequest,
  { db, variables }: Service.Context<InviteProvider>
): Promise<InviteResponse> {
  const body = await createInvite(
    db,
    request.identity.userId,
    request.parameters.id,
    variables.PUBLIC_LINK_HMAC_SECRET,
    variables.PUBLIC_WEB_ORIGIN
  );

  return { status: 200, body };
}
