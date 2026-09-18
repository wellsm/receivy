import type { Service } from '@ez4/common';
import { ServiceEventType } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpError } from '@ez4/gateway';
import { ApiError } from '../errors';
import { Logger, verboseLogging } from './logger';

/** Payloads above this size are summarized instead of logged, even locally. */
const MAX_INPUT_LENGTH = 50 * 1024;

/**
 * Production keeps the allowlisted telemetry: correlation id and status, never paths, headers, payloads or
 * exceptions. Locally (or with `APP_DEBUG=true`) every request and failure is logged in full, the way the
 * Rewarlo API does, so the developer sees what the app sent and what the API answered.
 */
export function requestListener(event: Service.AnyEvent<Http.Incoming<Http.Request>>, _context: Service.Context<Http.Provider>): void {
  if (verboseLogging()) {
    logVerbose(event);
  }

  if (event.type !== ServiceEventType.Done && event.type !== ServiceEventType.Error && event.type !== ServiceEventType.Timeout) {
    return;
  }

  const correlationId = /^[a-f0-9-]{36}$/.test(event.request.traceId ?? '') ? event.request.traceId : undefined;

  console.info({
    event:
      event.type === ServiceEventType.Done
        ? 'request_completed'
        : event.type === ServiceEventType.Timeout
          ? 'request_timeout'
          : 'request_failed',
    correlationId,
    ...(event.type === ServiceEventType.Error
      ? { status: event.error instanceof HttpError || event.error instanceof ApiError ? event.error.status : 500 }
      : {})
  });
}

function logVerbose(event: Service.AnyEvent<Http.Incoming<Http.Request>>): void {
  const { request } = event;

  if (event.type === ServiceEventType.Ready) {
    const data = 'data' in request ? request.data : undefined;

    if (typeof data === 'string' && data.length > MAX_INPUT_LENGTH) {
      Logger.warning('[EVENT OMITTED]', { traceId: request.traceId, maxLength: MAX_INPUT_LENGTH, length: data.length });

      return;
    }

    Logger.log('[EVENT]', { ...request });

    return;
  }

  if (event.type === ServiceEventType.Error) {
    const { requestId, method, path } = request as Http.Incoming<Http.Request> & { requestId?: string; method?: string; path?: string };

    Logger.error('[ERROR]', { requestId, method, path, error: event.error });
  }
}
