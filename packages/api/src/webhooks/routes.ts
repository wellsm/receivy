import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { fakePayHandler } from './endpoints/fake-pay';
import type { infinitePayWebhookHandler } from './endpoints/infinitepay';
import type { pagSeguroWebhookHandler } from './endpoints/pagseguro';
import type { stripeWebhookHandler } from './endpoints/stripe';
import type { whatsappEvolutionWebhookHandler } from './endpoints/whatsapp-evolution';
import type { whatsappMetaWebhookHandler } from './endpoints/whatsapp-meta';
import type { verifyWhatsappWebhookHandler } from './endpoints/whatsapp-meta-verify';

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
  Http.UseRoute<{ name: 'verifyWhatsappWebhook'; path: 'GET /webhooks/whatsapp/meta'; handler: typeof verifyWhatsappWebhookHandler }>,
  Http.UseRoute<{ name: 'whatsappMetaWebhook'; path: 'POST /webhooks/whatsapp/meta'; handler: typeof whatsappMetaWebhookHandler }>,
  Http.UseRoute<{
    name: 'whatsappEvolutionWebhook';
    path: 'POST /webhooks/whatsapp/evolution';
    handler: typeof whatsappEvolutionWebhookHandler;
    // Evolution posts `instance`, `data.keyId`, `data.wuid`: the default camelCase must not rename or drop them.
    preferences: { namingStyle: NamingStyle.Preserve };
  }>,
  Http.UseRoute<{
    name: 'fakeCheckoutPay';
    path: 'POST /dev/checkout/{provider}/{orderNsu}/pay';
    handler: typeof fakePayHandler;
  }>
];
