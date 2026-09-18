import { ServiceError } from '@ez4/common';

export type ApiErrorContext = { code: string; fields?: Record<string, string> };

/**
 * Domain error mapped to its status by `httpErrors` in `api.ts`. The gateway serializes it as
 * `{ type: 'error', message, context: { code, fields? } }`; `message` is user-facing pt-BR copy.
 */
export abstract class ApiError extends ServiceError<ApiErrorContext> {
  abstract readonly status: number;

  constructor(message: string, code: string, fields?: Record<string, string>) {
    super(message, fields ? { code, fields } : { code });
  }
}

export abstract class ConflictError extends ApiError {
  readonly status = 409;
}

export abstract class ForbiddenError extends ApiError {
  readonly status = 403;
}

export abstract class UnprocessableEntityError extends ApiError {
  readonly status = 422;
}

export abstract class RateLimitedError extends ApiError {
  readonly status = 429;
}

export abstract class ServiceUnavailableError extends ApiError {
  readonly status = 503;
}

export class TooManyRequestsError extends RateLimitedError {
  constructor(message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') {
    super(message, 'RATE_LIMITED');
  }
}
