import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail, BillingPatch } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';
import type { PatchBody } from '../utils/body';
import { validation } from '../utils/context';

declare class PatchRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: PatchBody;
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function patchBillingHandler({ identity, parameters, body }: PatchRequest, { avatarFiles, billings }: Service.Context<BillingProvider>): Promise<DetailResponse> {
  const billing = await validation(() => billings.patch(identity.userId, parameters.id, body as BillingPatch));

  return { status: 200, body: await AvatarRepository.sign(avatarFiles, billing) };
}
