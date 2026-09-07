import type { Service } from "@ez4/common";
import { ServiceEventType } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import { HttpError } from "@ez4/gateway";
import type { ApiProvider } from "../provider";

/** Allowlisted telemetry: never include paths, headers, payloads or exceptions. */
export function requestListener(event: Service.AnyEvent<Http.Incoming<Http.Request>>, _context: Service.Context<ApiProvider>): void {
  if (event.type !== ServiceEventType.Done && event.type !== ServiceEventType.Error && event.type !== ServiceEventType.Timeout) return;
  const correlationId = /^[a-f0-9-]{36}$/.test(event.request.traceId ?? "") ? event.request.traceId : undefined;
  console.info({ event: event.type === ServiceEventType.Done ? "request_completed" : event.type === ServiceEventType.Timeout ? "request_timeout" : "request_failed",
    correlationId, ...(event.type === ServiceEventType.Error ? { status: event.error instanceof HttpError ? event.error.status : 500 } : {}) });
}
