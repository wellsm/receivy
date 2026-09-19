import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ChargeProvider } from '../provider';
import { checkoutClients, inactivatePaymentLink, paymentLinkConfigFrom } from '../services/payment-link';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ItemResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function cancelChargeHandler(
  { identity, parameters }: IdRequest,
  { db, avatarFiles, charges, variables }: Service.Context<ChargeProvider>
): Promise<ItemResponse> {
  const charge = await charges.cancel(identity.userId, parameters.id);

  await inactivatePaymentLink(db, checkoutClients(variables), paymentLinkConfigFrom(variables), parameters.id);

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, charge) };
}
