import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PaymentMethodsPage } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PaymentMethodProvider } from '../provider';
import { PaymentMethodRepository } from '../repositories/payment-method';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: { contactId?: String.UUID };
}

declare class ListResponse implements Http.Response {
  status: 200;
  body: PaymentMethodsPage;
}

export async function listPaymentMethodsHandler(
  request: ListRequest,
  { db }: Service.Context<PaymentMethodProvider>
): Promise<ListResponse> {
  return {
    status: 200,
    body: {
      paymentMethods: await PaymentMethodRepository.list(db, request.identity.userId, request.query.contactId)
    }
  };
}
