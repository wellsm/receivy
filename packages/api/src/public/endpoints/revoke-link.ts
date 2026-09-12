import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PublicProvider } from '../provider';
import { revokePublicLink } from '../repositories/public-link';

declare class ChargeRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class EmptyResponse implements Http.Response {
  status: 204;
}

export async function revokePublicLinkHandler(request: ChargeRequest, context: Service.Context<PublicProvider>): Promise<EmptyResponse> {
  await revokePublicLink(context.db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
