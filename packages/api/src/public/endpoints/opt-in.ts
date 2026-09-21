import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProvider } from '../provider';

declare class TokenRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class OptInResponse implements Http.Response {
  status: 200;
  body: { optedOut: false };
}

export async function optInHandler({ parameters }: TokenRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<OptInResponse> {
  const { optedOut } = await publicLinks.optIn(parameters.token);

  return { status: 200, body: { optedOut: optedOut as false } };
}
