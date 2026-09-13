import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProofState } from '@receivy/common';
import { throttlePublicRead } from '../../common/utils/throttle';
import { PublicLinkRepository } from '../../public/repositories/public-link';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';

declare class PublicRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicStateResponse implements Http.Response {
  status: 200;
  body: PublicProofState;
}

export async function publicProofStateHandler(
  request: PublicRequest,
  { db, variables }: Service.Context<ProofProvider>
): Promise<PublicStateResponse> {
  const secret = variables.PUBLIC_LINK_HMAC_SECRET;
  const charge = await PublicLinkRepository.resolveCharge(db, request.parameters.token, secret);
  await throttlePublicRead(db, charge.public_id ?? charge.id);
  return { status: 200, body: ProofRepository.stateView(charge, request.parameters.token, secret) };
}
