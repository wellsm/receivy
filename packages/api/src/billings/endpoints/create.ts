import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail, BillingInput } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';
import type { BillingBody } from '../utils/body';
import { validation } from '../utils/context';

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  headers: { 'idempotency-key': String.Max<200> };
  body: BillingBody;
}

declare class CreateResponse implements Http.Response {
  status: 201;
  body: BillingDetail;
}

export async function createBillingHandler({ identity, headers, body }: CreateRequest, { avatarFiles, billings }: Service.Context<BillingProvider>): Promise<CreateResponse> {
  const billing = await validation(() => billings.create(identity.userId, headers['idempotency-key'], body as BillingInput));

  return { status: 201, body: await AvatarRepository.sign(avatarFiles, billing) };
}
