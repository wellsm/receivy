import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail, BillingPatch } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { noticeContext } from '../../notifications/services/context';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';
import { BillingRepository } from '../repositories/billing';
import type { PatchBody } from '../utils/body';
import { inviteLink, validation } from '../utils/context';

declare class PatchRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: PatchBody;
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function patchBillingHandler(
  request: PatchRequest,
  { db, variables, email, chargeNotifyScheduler, proofFiles }: Service.Context<BillingProvider>
): Promise<DetailResponse> {
  const body = await validation(() =>
    BillingRepository.patch(
      db,
      request.identity.userId,
      request.parameters.id,
      request.body as BillingPatch,
      new Date(),
      inviteLink({ variables }),
      noticeContext({ chargeNotifyScheduler, email, variables })
    )
  );

  return { status: 200, body: await AvatarRepository.sign(proofFiles, body) };
}
