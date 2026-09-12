import { Runtime } from '@ez4/common';

type Context = Record<string, unknown>;

/** Verbose lines (request payloads, errors with their causes) only leave the process locally or with `APP_DEBUG=true`. */
export function verboseLogging(): boolean {
  return process.env.APP_DEBUG === 'true' || Runtime.isLocal();
}

/**
 * `Runtime.getScope()` carries the trace id of the request in flight, so every line correlates without
 * the caller threading anything through. Mirrors the Rewarlo logger so both APIs read the same locally.
 */
export const Logger = {
  debug(message: string, context?: Context): void {
    if (verboseLogging()) {
      console.debug({ ...Runtime.getScope(), message, context });
    }
  },
  log(message: string, context?: Context): void {
    console.log({ ...Runtime.getScope(), message, context });
  },
  warning(message: string, context?: Context): void {
    console.warn({ ...Runtime.getScope(), message, context });
  },
  error(message: string, context?: Context): void {
    console.error({ ...Runtime.getScope(), message, context });
  }
};
