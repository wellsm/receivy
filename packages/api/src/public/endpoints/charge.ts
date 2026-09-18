import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicChargeView } from '@receivy/common';
import type { PublicProvider } from '../provider';

declare class TokenRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicResponse implements Http.Response {
  status: 200;
  body: PublicChargeView;
}

export async function publicChargeHandler({ parameters }: TokenRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<PublicResponse> {
  const { view } = await publicLinks.view(parameters.token);

  return { status: 200, body: view };
}
