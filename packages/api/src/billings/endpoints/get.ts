import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { BillingProvider } from '../provider';
import { BillingRepository } from '../repositories/billing';
import { inviteLink } from '../utils/context';

declare class ReadRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function getBillingHandler(
  request: ReadRequest,
  { db, variables, proofFiles }: Service.Context<BillingProvider>
): Promise<DetailResponse> {
  return {
    status: 200,
    body: await AvatarRepository.sign(
      proofFiles,
      await BillingRepository.get(db, request.identity.userId, request.parameters.id, new Date(), inviteLink({ variables }))
    )
  };
}
