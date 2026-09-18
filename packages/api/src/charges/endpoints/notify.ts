import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ChargeDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ChargeProvider } from '../provider';

declare class NotifyRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: { notify: boolean };
}

declare class ItemResponse implements Http.Response {
  status: 200;
  body: ChargeDetail;
}

export async function setChargeNotifyHandler(
  { identity, parameters, body }: NotifyRequest,
  { avatarFiles, charges }: Service.Context<ChargeProvider>
): Promise<ItemResponse> {
  const detail = await charges.setNotify(identity.userId, parameters.id, body.notify);

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, detail) };
}
