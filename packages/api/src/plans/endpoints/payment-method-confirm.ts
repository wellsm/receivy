import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class ConfirmBody implements Http.JsonBody {
  paymentMethodId: String.Max<64>;
}

declare class ConfirmRequest implements Http.Request {
  identity: SessionIdentity;
  body: ConfirmBody;
}

declare class DoneResponse implements Http.Response {
  status: 204;
}

export async function confirmPlanPaymentMethodHandler({ identity, body }: ConfirmRequest, { plans }: Service.Context<PlanProvider>): Promise<DoneResponse> {
  await plans.confirmPaymentMethod(identity.userId, body.paymentMethodId);

  return { status: 204 };
}
