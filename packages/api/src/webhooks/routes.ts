import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { infinitePayWebhookHandler } from './endpoints/infinitepay';

export type WebhookRoutes = [
  Http.UseRoute<{
    name: 'infinitePayWebhook';
    path: 'POST /webhooks/infinitepay/{token}';
    handler: typeof infinitePayWebhookHandler;
    // InfinitePay posts snake_case; the API default (camelCase) must not rename the fields.
    preferences: { namingStyle: NamingStyle.Preserve };
  }>
];
