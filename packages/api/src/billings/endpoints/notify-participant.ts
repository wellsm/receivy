import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';

declare class NotifyParticipantRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID; userId: String.UUID };
  body: { notify: boolean };
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function setParticipantNotifyHandler({ identity, parameters, body }: NotifyParticipantRequest, { avatarFiles, billings }: Service.Context<BillingProvider>): Promise<DetailResponse> {
  const detail = await billings.setParticipantNotify(identity.userId, parameters.id, parameters.userId, body.notify);

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, detail) };
}
