import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ProofUploadTicket } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { ProofProvider } from '../provider';
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

export async function startProofUploadHandler({ identity, parameters, body }: UploadRequest, { proofs }: Service.Context<ProofProvider>): Promise<TicketResponse> {
  return { status: 200, body: await proofs.startUpload({ userId: identity.userId }, parameters.id, body) };
}
