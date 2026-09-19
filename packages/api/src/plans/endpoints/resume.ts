import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class ResumeRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class DoneResponse implements Http.Response {
  status: 204;
}

export async function resumePlanHandler({ identity }: ResumeRequest, { plans }: Service.Context<PlanProvider>): Promise<DoneResponse> {
  await plans.resume(identity.userId);

  return { status: 204 };
}
