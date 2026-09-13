import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ProofUploadTicket } from '@receivy/common';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';
import { resolveThrottledActor } from '../utils/actor';
import type { UploadBody } from '../utils/body';

declare class PublicUploadRequest implements Http.Request {
  parameters: { token: String.Max<200> };
  body: UploadBody;
}

declare class TicketResponse implements Http.Response {
  status: 200;
  body: ProofUploadTicket;
}

export async function publicStartProofUploadHandler(
  request: PublicUploadRequest,
  { db, variables, proofFiles, uploadExpiryScheduler }: Service.Context<ProofProvider>
): Promise<TicketResponse> {
  const { charge, actor } = await resolveThrottledActor({ db, variables }, request.parameters.token);
  return {
    status: 200,
    body: await ProofRepository.startUpload(db, bucketProofStorage(proofFiles), uploadExpiryScheduler, charge.id, actor, request.body)
  };
}
