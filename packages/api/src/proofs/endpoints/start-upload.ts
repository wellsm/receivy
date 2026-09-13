import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ProofUploadTicket } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';
import type { UploadBody } from '../utils/body';

declare class UploadRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: UploadBody;
}

declare class TicketResponse implements Http.Response {
  status: 200;
  body: ProofUploadTicket;
}

export async function startProofUploadHandler(
  request: UploadRequest,
  { db, proofFiles, uploadExpiryScheduler }: Service.Context<ProofProvider>
): Promise<TicketResponse> {
  return {
    status: 200,
    body: await ProofRepository.startUpload(
      db,
      bucketProofStorage(proofFiles),
      uploadExpiryScheduler,
      request.parameters.id,
      { userId: request.identity.userId },
      request.body
    )
  };
}
