import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PaymentMethod } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PaymentMethodProvider } from '../provider';
import { savePaymentMethod } from '../repositories/payment-method';
import { type PaymentMethodBody, paymentMethodInput, safe } from '../utils/input';

declare class EditRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: PaymentMethodBody;
}

declare class EditResponse implements Http.Response {
  status: 200;
  body: PaymentMethod;
}

export async function editPaymentMethodHandler(
  request: EditRequest,
  context: Service.Context<PaymentMethodProvider>
): Promise<EditResponse> {
  return {
    status: 200,
    body: await safe(() => savePaymentMethod(context.db, request.identity.userId, paymentMethodInput(request.body), request.parameters.id))
  };
}
