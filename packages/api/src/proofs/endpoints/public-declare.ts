import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProofState } from '@receivy/common';
import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';
import type { ProofProvider } from '../provider';
import { resolveThrottledActor } from '../utils/actor';

declare class PublicDeclareRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class PublicStateResponse implements Http.Response {
  status: 200;
  body: PublicProofState;
}

export async function publicDeclarePaymentHandler({ parameters }: PublicDeclareRequest, { db, proofs, variables }: Service.Context<ProofProvider>): Promise<PublicStateResponse> {
  const { charge, actor } = await resolveThrottledActor({ db, variables }, parameters.token);
  const row = await proofs.declare(actor, charge.id);

  await pushPaymentNotice(db, paymentNoticeContext(variables), row.id, PaymentNotice.Declared);

  return { status: 200, body: await proofs.publicState(row.id, actor.token) };
}
