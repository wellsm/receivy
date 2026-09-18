import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProofState } from '@receivy/common';
import { throttlePublicRead } from '../../common/utils/throttle';
import { resolvePublicCharge } from '../../public/services/public-link';
import type { ProofProvider } from '../provider';

declare class PublicRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicStateResponse implements Http.Response {
  status: 200;
  body: PublicProofState;
}

export async function publicProofStateHandler({ parameters }: PublicRequest, { db, proofs, variables }: Service.Context<ProofProvider>): Promise<PublicStateResponse> {
  const charge = await resolvePublicCharge(db, parameters.token, variables.PUBLIC_LINK_HMAC_SECRET);

  await throttlePublicRead(db, charge.id);

  return { status: 200, body: await proofs.publicState(charge.id, parameters.token) };
}
