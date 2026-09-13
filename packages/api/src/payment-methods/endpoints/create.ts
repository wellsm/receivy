import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PaymentMethod } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PaymentMethodProvider } from '../provider';
import { PaymentMethodRepository } from '../repositories/payment-method';
import { type PaymentMethodBody, paymentMethodInput, safe } from '../utils/input';

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  body: PaymentMethodBody;
}

declare class CreateResponse implements Http.Response {
  status: 201;
  body: PaymentMethod;
}

export async function createPaymentMethodHandler(
  request: CreateRequest,
  { db }: Service.Context<PaymentMethodProvider>
): Promise<CreateResponse> {
  return {
    status: 201,
    body: await safe(() => PaymentMethodRepository.save(db, request.identity.userId, paymentMethodInput(request.body)))
  };
}
