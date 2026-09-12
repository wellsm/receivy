import type { Http } from '@ez4/gateway';
import type { healthHandler } from './endpoints/health';

export type HealthRoutes = [
  Http.UseRoute<{
    name: 'health';
    path: 'GET /health';
    handler: typeof healthHandler;
  }>
];
