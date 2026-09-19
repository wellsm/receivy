import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SetupResult } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class SetupRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class SetupResponse implements Http.Response {
  status: 200;
  body: SetupResult;
}

export async function setupPlanPaymentMethodHandler({ identity }: SetupRequest, { plans }: Service.Context<PlanProvider>): Promise<SetupResponse> {
  return { status: 200, body: await plans.setupPaymentMethod(identity.userId) };
}
