import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PublicProvider } from '../provider';

declare class ChargeByLinkRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { token: String.Max<200> };
}

declare class ChargeByLinkResponse implements Http.Response {
  status: 200;
  body: { id: string };
}

/** Back from the checkout with a session: the public token names the charge the signed-in participant may open in the app. */
export async function chargeByLinkHandler({ identity, parameters }: ChargeByLinkRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<ChargeByLinkResponse> {
  return { status: 200, body: { id: await publicLinks.chargeId(identity.userId, parameters.token) } };
}
