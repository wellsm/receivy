import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';

declare class ChargeRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class DownloadResponse implements Http.Response {
  status: 200;
  body: { url: string; expiresIn: number };
}

export async function downloadProofHandler(
  request: ChargeRequest,
  { db, proofFiles }: Service.Context<ProofProvider>
): Promise<DownloadResponse> {
  return {
    status: 200,
    body: await ProofRepository.downloadUrl(db, bucketProofStorage(proofFiles), request.parameters.id, request.identity.userId)
  };
}
