import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicChargeView } from '@receivy/common';
import { paymentLinkProvider } from '../../charges/services/payment-link';
import { settleByProvider } from '../../charges/services/settle';
import { notificationTransport } from '../../notifications/services/transport';
import { PaymentLinkUnavailableError } from '../../payment-methods/errors';
import type { PublicProvider } from '../provider';

declare class ProviderReturnBody implements Http.JsonBody {
  orderNsu: String.Max<200>;
  transactionNsu: String.Max<200>;
  slug: String.Max<200>;
}

declare class ProviderReturnRequest implements Http.Request {
  parameters: { token: String.Max<200> };
  body: ProviderReturnBody;
}

declare class PublicResponse implements Http.Response {
  status: 200;
  body: PublicChargeView;
}

/** The payer came back from InfinitePay with the ids of what they paid: the same finalizer the webhook uses closes the charge. */
export async function providerReturnHandler({ parameters, body }: ProviderReturnRequest, { db, publicLinks, variables }: Service.Context<PublicProvider>): Promise<PublicResponse> {
  const { charge } = await publicLinks.view(parameters.token);

  if (body.orderNsu !== charge.id) {
    throw new HttpBadRequestError('Pedido não corresponde à cobrança.');
  }

  const outcome = await settleByProvider(
    db,
    paymentLinkProvider(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { chargeId: charge.id, transactionNsu: body.transactionNsu, slug: body.slug }
  );

  if (outcome === 'unavailable') {
    throw new PaymentLinkUnavailableError();
  }

  return { status: 200, body: (await publicLinks.view(parameters.token)).view };
}
