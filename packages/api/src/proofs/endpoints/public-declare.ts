import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProofState } from '@receivy/common';
import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';
import type { ProofProvider } from '../provider';
import { ProofRepository } from '../repositories/proof';
import { bucketProofStorage } from '../services/bucket-storage';
import { resolveThrottledActor } from '../utils/actor';

declare class PublicDeclareRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicStateResponse implements Http.Response {
  status: 200;
  body: PublicProofState;
}

export async function publicDeclarePaymentHandler(
  request: PublicDeclareRequest,
  { db, variables, proofFiles }: Service.Context<ProofProvider>
): Promise<PublicStateResponse> {
  const { charge, actor } = await resolveThrottledActor({ db, variables }, request.parameters.token);
  const row = await ProofRepository.declare(db, bucketProofStorage(proofFiles), charge.id, actor);

  await pushPaymentNotice(db, paymentNoticeContext(variables), row.id, PaymentNotice.Declared);

  return { status: 200, body: ProofRepository.stateView(row, actor.token, actor.secret) };
}
