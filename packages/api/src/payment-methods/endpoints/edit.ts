import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PaymentMethod } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PaymentMethodProvider } from '../provider';
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
  { identity, parameters, body }: EditRequest,
  { paymentMethods }: Service.Context<PaymentMethodProvider>
): Promise<EditResponse> {
  return { status: 200, body: await safe(() => paymentMethods.save(identity.userId, paymentMethodInput(body), parameters.id)) };
}
