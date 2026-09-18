import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
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

export async function cancelChargeHandler({ identity, parameters }: IdRequest, { avatarFiles, charges }: Service.Context<ChargeProvider>): Promise<ItemResponse> {
  return { status: 200, body: await AvatarRepository.sign(avatarFiles, await charges.cancel(identity.userId, parameters.id)) };
}
