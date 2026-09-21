import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProvider } from '../provider';

declare class TokenRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class OptOutResponse implements Http.Response {
  status: 200;
  body: { optedOut: true };
}

export async function optOutHandler({ parameters }: TokenRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<OptOutResponse> {
  const { optedOut } = await publicLinks.optOut(parameters.token);

  return { status: 200, body: { optedOut: optedOut as true } };
}
