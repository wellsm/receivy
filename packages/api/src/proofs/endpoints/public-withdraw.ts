import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';
import { resolveThrottledActor } from '../utils/actor';

declare class PublicRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class EmptyResponse implements Http.Response {
  status: 204;
}

export async function publicWithdrawProofHandler(
  request: PublicRequest,
  { db, variables, proofFiles }: Service.Context<ProofProvider>
): Promise<EmptyResponse> {
  const { charge, actor } = await resolveThrottledActor({ db, variables }, request.parameters.token);
  await ProofRepository.withdraw(db, bucketProofStorage(proofFiles), charge.id, actor);
  return { status: 204 };
}
