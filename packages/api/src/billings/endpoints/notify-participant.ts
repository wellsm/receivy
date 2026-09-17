import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';
import { BillingRepository } from '../repositories/billing';
import { inviteLink } from '../utils/context';

declare class NotifyParticipantRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID; userId: String.UUID };
  body: { notify: boolean };
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function setParticipantNotifyHandler(
  request: NotifyParticipantRequest,
  { db, variables, avatarFiles }: Service.Context<BillingProvider>
): Promise<DetailResponse> {
  const detail = await BillingRepository.setParticipantNotify(
    db,
    request.identity.userId,
    request.parameters.id,
    request.parameters.userId,
    request.body.notify,
    new Date(),
    inviteLink({ variables })
  );

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, detail) };
}
