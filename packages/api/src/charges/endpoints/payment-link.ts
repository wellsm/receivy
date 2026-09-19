import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { notificationTransport } from '../../notifications/services/transport';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ChargeProvider } from '../provider';
import { checkoutClients, ensurePaymentLink, paymentLinkConfigFrom } from '../services/payment-link';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ItemResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

/** "Gerar link de novo": asks InfinitePay again for a charge whose link failed. A ready link answers as is. */
export async function ensurePaymentLinkHandler(
  { identity, parameters }: IdRequest,
  { db, avatarFiles, charges, variables }: Service.Context<ChargeProvider>
): Promise<ItemResponse> {
  const { userId } = identity;

  // Reading as the actor is the access check: owner, creditor and debtor may read, anyone else is refused.
  await charges.get(userId, parameters.id);
  await ensurePaymentLink(db, checkoutClients(variables), paymentLinkConfigFrom(variables), parameters.id, Date.now(), notificationTransport(variables));

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, await charges.get(userId, parameters.id)) };
}
