import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { paymentLinkProvider } from '../../charges/services/payment-link';
import { settleByProvider } from '../../charges/services/settle';
import { notificationTransport } from '../../notifications/services/transport';
import { PublicTokenPurpose, verifyPublicChargeToken } from '../../public/services/capability';
import type { WebhookProvider } from '../provider';

/** Every field optional: a body InfinitePay changed tomorrow must still get a 200, never a retry storm. */
declare class InfinitePayWebhookBody implements Http.JsonBody {
  invoice_slug?: String.Max<200>;
  transaction_nsu?: String.Max<200>;
  order_nsu?: String.Max<200>;
  receipt_url?: String.Max<500>;
  amount?: number;
  paid_amount?: number;
  installments?: number;
  capture_method?: String.Max<40>;
}

declare class WebhookRequest implements Http.Request {
  parameters: { token: String.Max<300> };
  body: InfinitePayWebhookBody;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

/**
 * InfinitePay's "paid" ping. The token only names the charge; the money is confirmed by `payment_check`
 * inside `settleByProvider`. 200 closes the delivery (processed, replayed, forged or ignored alike);
 * 400 is reserved for "our side could not ask the provider", which InfinitePay retries.
 */
export async function infinitePayWebhookHandler({ parameters, body }: WebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  let chargeId: string;

  try {
    chargeId = verifyPublicChargeToken(parameters.token, { secret: variables.PUBLIC_LINK_HMAC_SECRET, purpose: PublicTokenPurpose.ProviderWebhook }).publicId;
  } catch {
    return RECEIVED;
  }

  if (!body.transaction_nsu || !body.invoice_slug || body.order_nsu !== chargeId) {
    return RECEIVED;
  }

  const outcome = await settleByProvider(
    db,
    paymentLinkProvider(variables),
    { transport: notificationTransport(variables), origin: variables.PUBLIC_WEB_ORIGIN },
    { chargeId, transactionNsu: body.transaction_nsu, slug: body.invoice_slug, receiptUrl: body.receipt_url }
  );

  console.info('InfinitePay webhook', { chargeId, outcome });

  if (outcome === 'unavailable') {
    throw new HttpBadRequestError('Payment check unavailable');
  }

  return RECEIVED;
}
