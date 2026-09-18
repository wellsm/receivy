import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { type ChargeDetail, ChargeState, type ProofState } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ProofProvider } from '../provider';

declare class ReviewRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: { decision: ProofState.Accepted | ProofState.Rejected; reason?: String.Max<500> };
}

declare class ChargeResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function reviewProofHandler({ identity, parameters, body }: ReviewRequest, { db, avatarFiles, proofs, variables }: Service.Context<ProofProvider>): Promise<ChargeResponse> {
  const detail = await proofs.review(identity.userId, parameters.id, body);
  const notice = detail.state === ChargeState.Paid ? PaymentNotice.Confirmed : PaymentNotice.NotIdentified;

  await pushPaymentNotice(db, paymentNoticeContext(variables), detail.id, notice);

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, detail) };
}
