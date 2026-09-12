import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PaymentMethod } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PaymentMethodProvider } from '../provider';
import { makeDefaultPaymentMethod } from '../repositories/payment-method';

declare class DefaultRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class DefaultResponse implements Http.Response {
  status: 200;
  body: PaymentMethod;
}

export async function defaultPaymentMethodHandler(
  request: DefaultRequest,
  context: Service.Context<PaymentMethodProvider>
): Promise<DefaultResponse> {
  return { status: 200, body: await makeDefaultPaymentMethod(context.db, request.identity.userId, request.parameters.id) };
}
