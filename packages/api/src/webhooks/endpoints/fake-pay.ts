import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpNotFoundError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { PaymentProvider } from '@receivy/common';
import { checkoutClients, PaymentLinkMode } from '../../charges/services/payment-link';
import { settleByProvider } from '../../charges/services/settle';
import { notificationTransport } from '../../notifications/services/transport';
import type { WebhookProvider } from '../provider';

declare class FakePayRequest implements Http.Request {
  parameters: { provider: String.Max<40>; orderNsu: String.UUID };
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

/** Local only: what the PagBank webhook would do, triggered by the web's fake checkout page. 404 anywhere `PAYMENT_METHOD_LINK` is not `fake`. */
export async function fakePayHandler({ parameters }: FakePayRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  if (variables.PAYMENT_METHOD_LINK !== PaymentLinkMode.Fake || parameters.provider !== PaymentProvider.PagSeguro) {
    throw new HttpNotFoundError();
  }

  const outcome = await settleByProvider(
    db,
    checkoutClients(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { provider: PaymentProvider.PagSeguro, chargeId: parameters.orderNsu, transactionNsu: `fake-${Date.now()}`, orderId: parameters.orderNsu, credential: 'fake' }
  );

  console.info('Fake PagBank payment', { chargeId: parameters.orderNsu, outcome });

  return RECEIVED;
}
