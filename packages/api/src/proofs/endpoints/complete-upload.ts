import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import type { SessionIdentity } from '../../common/authorizers/session';
import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';

declare class CompleteRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ChargeResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function completeProofUploadHandler(
  request: CompleteRequest,
  { db, proofFiles, variables }: Service.Context<ProofProvider>
): Promise<ChargeResponse> {
  const { userId } = request.identity;
  const row = await ProofRepository.completeUpload(db, bucketProofStorage(proofFiles), request.parameters.id, { userId });

  await pushPaymentNotice(db, paymentNoticeContext(variables), row.id, PaymentNotice.ProofReceived);

  return { status: 200, body: await AvatarRepository.sign(proofFiles, await ChargeRepository.dto(db, row, userId)) };
}
