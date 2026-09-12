import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProofState } from '@receivy/common';
import { throttlePublicRead } from '../../common/utils/throttle';
import { resolvePublicCharge } from '../../public/repositories/public-link';
import type { ProofProvider } from '../provider';
import { proofStateView } from '../repositories/proof';

declare class PublicRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicStateResponse implements Http.Response {
  status: 200;
  body: PublicProofState;
}

export async function publicProofStateHandler(
  request: PublicRequest,
  context: Service.Context<ProofProvider>
): Promise<PublicStateResponse> {
  const secret = context.variables.PUBLIC_LINK_HMAC_SECRET;
  const charge = await resolvePublicCharge(context.db, request.parameters.token, secret);
  await throttlePublicRead(context.db, charge.public_id ?? charge.id);
  return { status: 200, body: proofStateView(charge, request.parameters.token, secret) };
}
