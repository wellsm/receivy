import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ProofProvider } from '../provider';
import { reviewProof } from '../repositories/proof';

declare class ReviewRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: { decision: 'accepted' | 'rejected'; reason?: String.Max<500> };
}

declare class ChargeResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function reviewProofHandler(request: ReviewRequest, context: Service.Context<ProofProvider>): Promise<ChargeResponse> {
  return { status: 200, body: await reviewProof(context.db, request.parameters.id, request.identity.userId, request.body) };
}
