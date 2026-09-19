import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SubscribeResult } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class SubscribeRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class SubscribeResponse implements Http.Response {
  status: 200;
  body: SubscribeResult;
}

export async function subscribePlanHandler({ identity }: SubscribeRequest, { plans }: Service.Context<PlanProvider>): Promise<SubscribeResponse> {
  return { status: 200, body: await plans.subscribe(identity.userId) };
}
