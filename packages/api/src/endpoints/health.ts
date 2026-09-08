import type { Http } from '@ez4/gateway';
import type { HealthResponse as HealthBody } from '@receivy/common';

declare class HealthResponse implements Http.Response {
  status: 200;
  body: HealthBody;
}

export function healthHandler(): HealthResponse {
  return {
    status: 200,
    body: { status: 'ok', service: 'receivy-api' }
  };
}
