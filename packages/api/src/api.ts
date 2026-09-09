import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type { AccountRoutes } from './routes/account';
import type { AuthRoutes } from './routes/auth';
import type { BillingRoutes } from './routes/billings';
import type { ChargeRoutes } from './routes/charges';
import type { HealthRoutes } from './routes/health';
import type { InviteRoutes } from './routes/invites';
import type { NotificationRoutes } from './routes/notifications';
import type { PaymentMethodRoutes } from './routes/payment-methods';
import type { PeopleRoutes } from './routes/people';
import type { ProofRoutes } from './routes/proofs';
import type { PublicRoutes } from './routes/public';
import type { TimelineRoutes } from './routes/timeline';
import type { requestListener } from './security/listener';

/** Receivy HTTP API. */
export declare class Api extends Http.Service {
  name: 'Receivy API';
  cache: Http.UseCache<{ authorizerTTL: 0 }>;

  defaults: Http.UseDefaults<{
    listener: typeof requestListener;
    preferences: {
      namingStyle: NamingStyle.CamelCase;
    };
  }>;

  routes: [
    ...HealthRoutes,
    ...AuthRoutes,
    ...PeopleRoutes,
    ...PaymentMethodRoutes,
    ...BillingRoutes,
    ...ChargeRoutes,
    ...PublicRoutes,
    ...InviteRoutes,
    ...TimelineRoutes,
    ...ProofRoutes,
    ...NotificationRoutes,
    ...AccountRoutes
  ];

  // Browsers reach the API only through the Next BFF; this list matters for tooling and
  // must include the web origin of each published stage (see docs/environments.md).
  cors: Http.UseCors<{
    allowOrigins: ['http://localhost:3000', 'https://receivy.wellsm.dev'];
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'];
    allowHeaders: ['content-type', 'authorization', 'idempotency-key'];
    allowCredentials: true;
  }>;
}
