import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicLink } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PublicProvider } from '../provider';

declare class ChargeRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class LinkResponse implements Http.Response {
  status: 200;
  body: PublicLink;
}

export async function rotatePublicLinkHandler({ identity, parameters }: ChargeRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<LinkResponse> {
  return { status: 200, body: await publicLinks.rotate(identity.userId, parameters.id) };
}
