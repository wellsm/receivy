import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingInvite, InviteAcceptResult, PublicInviteView } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { throttlePublicRead } from '../security/throttle';
import { acceptInvite, createInvite, getPublicInvite, revokeInvite } from './repository';

declare class BillingRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class PublicTokenRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class AcceptRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { token: String.Max<200> };
}

declare class InviteResponse implements Http.Response {
  status: 200;
  body: BillingInvite;
}

declare class EmptyResponse implements Http.Response {
  status: 204;
}

declare class PublicInviteResponse implements Http.Response {
  status: 200;
  body: PublicInviteView;
}

declare class AcceptResponse implements Http.Response {
  status: 200;
  body: InviteAcceptResult;
}

export async function createInviteHandler(request: BillingRequest, context: Service.Context<ApiProvider>): Promise<InviteResponse> {
  const body = await createInvite(
    context.db,
    request.identity.userId,
    request.parameters.id,
    context.variables.PUBLIC_LINK_HMAC_SECRET,
    context.variables.PUBLIC_WEB_ORIGIN
  );

  return { status: 200, body };
}

export async function revokeInviteHandler(request: BillingRequest, context: Service.Context<ApiProvider>): Promise<EmptyResponse> {
  await revokeInvite(context.db, request.identity.userId, request.parameters.id);

  return { status: 204 };
}

export async function publicInviteHandler(
  request: PublicTokenRequest,
  context: Service.Context<ApiProvider>
): Promise<PublicInviteResponse> {
  await throttlePublicRead(context.db, request.parameters.token, request);

  return { status: 200, body: await getPublicInvite(context.db, request.parameters.token, context.variables.PUBLIC_LINK_HMAC_SECRET) };
}

export async function acceptInviteHandler(request: AcceptRequest, context: Service.Context<ApiProvider>): Promise<AcceptResponse> {
  await throttlePublicRead(context.db, request.parameters.token, request);

  const body = await acceptInvite(context.db, request.identity.userId, request.parameters.token, context.variables.PUBLIC_LINK_HMAC_SECRET);

  return { status: 200, body };
}
