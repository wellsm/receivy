import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import type { SessionIdentity } from '../../common/authorizers/session';
import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ProofProvider } from '../provider';

declare class DeclareRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ChargeResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function declarePaymentHandler({ identity, parameters }: DeclareRequest, { db, avatarFiles, proofs, variables }: Service.Context<ProofProvider>): Promise<ChargeResponse> {
  const { userId } = identity;
  const row = await proofs.declare({ userId }, parameters.id);

  await pushPaymentNotice(db, paymentNoticeContext(variables), row.id, PaymentNotice.Declared);

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, await ChargeRepository.dto(db, row, userId)) };
}
