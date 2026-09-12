import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ProofProvider } from '../provider';
import { withdrawProof } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';

declare class ChargeRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class EmptyResponse implements Http.Response {
  status: 204;
}

export async function withdrawProofHandler(request: ChargeRequest, context: Service.Context<ProofProvider>): Promise<EmptyResponse> {
  await withdrawProof(context.db, bucketProofStorage(context.proofFiles), request.parameters.id, { userId: request.identity.userId });
  return { status: 204 };
}
