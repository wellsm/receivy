import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class CancelRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class DoneResponse implements Http.Response {
  status: 204;
}

export async function cancelPlanHandler({ identity }: CancelRequest, { plans }: Service.Context<PlanProvider>): Promise<DoneResponse> {
  await plans.cancel(identity.userId);

  return { status: 204 };
}
