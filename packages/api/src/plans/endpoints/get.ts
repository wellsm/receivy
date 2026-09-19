import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PlanSummary } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class GetRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class GetResponse implements Http.Response {
  status: 200;
  body: PlanSummary;
}

export async function getPlanHandler({ identity }: GetRequest, { plans }: Service.Context<PlanProvider>): Promise<GetResponse> {
  return { status: 200, body: await plans.get(identity.userId) };
}
