import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicChargeView } from '@receivy/common';
import { throttlePublicRead } from '../../common/utils/throttle';
import type { PublicProvider } from '../provider';

declare class TokenRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicResponse implements Http.Response {
  status: 200;
  body: PublicChargeView;
}

export async function publicChargeHandler({ parameters }: TokenRequest, { db, publicLinks }: Service.Context<PublicProvider>): Promise<PublicResponse> {
  const { charge, view } = await publicLinks.view(parameters.token);

  await throttlePublicRead(db, charge.id);

  return { status: 200, body: view };
}
