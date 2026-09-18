import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { type ChargeDetail, ProofState } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { PaymentNotice, paymentNoticeContext, pushPaymentNotice } from '../../notifications/services/payment-notices';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ChargeProvider } from '../provider';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ItemResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function payChargeHandler(
  { identity, parameters }: IdRequest,
  { db, avatarFiles, charges, variables }: Service.Context<ChargeProvider>
): Promise<ItemResponse> {
  const { userId } = identity;
  const detail = await charges.pay(userId, parameters.id);

  // Settling by hand answered whatever waited in review: whoever paid hears it like a confirmation, unless they settled it.
  if (detail.proof?.state === ProofState.Accepted && detail.proof.reviewedAt === detail.paidAt) {
    await pushPaymentNotice(db, paymentNoticeContext(variables), detail.id, PaymentNotice.Confirmed, userId);
  }

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, detail) };
}
