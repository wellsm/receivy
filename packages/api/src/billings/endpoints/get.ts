import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';

declare class ReadRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function getBillingHandler({ identity, parameters }: ReadRequest, { avatarFiles, billings }: Service.Context<BillingProvider>): Promise<DetailResponse> {
  return { status: 200, body: await AvatarRepository.sign(avatarFiles, await billings.get(identity.userId, parameters.id)) };
}
