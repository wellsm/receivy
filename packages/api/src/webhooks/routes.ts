import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { fakePayHandler } from './endpoints/fake-pay';
import type { infinitePayWebhookHandler } from './endpoints/infinitepay';
import type { pagSeguroWebhookHandler } from './endpoints/pagseguro';
import type { stripeWebhookHandler } from './endpoints/stripe';

export type WebhookRoutes = [
  Http.UseRoute<{
    name: 'infinitePayWebhook';
    path: 'POST /webhooks/infinitepay/{token}';
    handler: typeof infinitePayWebhookHandler;
    // InfinitePay posts snake_case; the API default (camelCase) must not rename the fields.
    preferences: { namingStyle: NamingStyle.Preserve };
  }>,
  Http.UseRoute<{
    name: 'pagSeguroWebhook';
    path: 'POST /webhooks/pagseguro/{token}';
    handler: typeof pagSeguroWebhookHandler;
  }>,
  Http.UseRoute<{
    name: 'stripeWebhook';
    path: 'POST /webhooks/stripe';
    handler: typeof stripeWebhookHandler;
  }>,
  Http.UseRoute<{
    name: 'fakeCheckoutPay';
    path: 'POST /dev/checkout/{provider}/{orderNsu}/pay';
    handler: typeof fakePayHandler;
  }>
];
