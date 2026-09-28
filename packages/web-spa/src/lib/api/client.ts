import type { SessionTokens } from "@receivy/common";
import { clearSession, getAccessToken, loadRefreshToken, storeSession } from "@/lib/auth/session";
import { readEnv } from "@/lib/env";
import { ApiError, SessionExpiredError, UNAVAILABLE_MESSAGE } from "./errors";

export { ApiError, SessionExpiredError } from "./errors";

export type ApiInit = RequestInit & {
  /** false for the unauthenticated auth routes: no Bearer, no refresh on 401. */
  auth?: boolean;
  idempotencyKey?: string;
};

/** Two rounds cover a sibling tab that rotated first (409); more than that is a dead session. */
const MAX_REFRESH_ROUNDS = 2;
const STALE_SESSION = 409;

let refreshInFlight: Promise<boolean> | null = null;

export function apiUrl(path: string): string {
  return `${readEnv().apiUrl}/${path.replace(/^\//, "")}`;
}

function send(path: string, init: ApiInit): Promise<Response> {
  const { auth = true, idempotencyKey, headers, ...rest } = init;
  const merged = new Headers(headers);

  merged.set("content-type", "application/json");

  if (idempotencyKey) {
    merged.set("idempotency-key", idempotencyKey);
  }

  const accessToken = getAccessToken();

  if (auth && accessToken) {
    merged.set("authorization", `Bearer ${accessToken}`);
  }

  return fetch(apiUrl(path), { ...rest, headers: merged, cache: "no-store" });
}

async function refreshOnce(): Promise<boolean> {
  for (let round = 0; round < MAX_REFRESH_ROUNDS; round++) {
    // Read only now: another tab may have rotated the token while this one waited.
    const refreshToken = loadRefreshToken();

    if (!refreshToken) {
      clearSession();

      return false;
    }

    // A network failure here propagates untouched: the session survives an outage; apiJson reports it as unavailable.
    const response = await send("auth/refresh", { auth: false, method: "POST", body: JSON.stringify({ refreshToken }) });

    if (response.ok) {
      storeSession((await response.json()) as SessionTokens);

      return true;
    }

    // 409: another tab consumed this refresh token moments ago and stored the rotated pair. Retry with it.
    if (response.status !== STALE_SESSION) {
      clearSession();

      return false;
    }
  }

  clearSession();

  return false;
}

/** One refresh at a time per tab; callers share the promise. */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshOnce().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const response = await send(path, init);

  if (response.status !== 401 || init.auth === false) {
    return response;
  }

  const refreshed = await refreshSession();

  if (!refreshed) {
    throw new SessionExpiredError();
  }

  return send(path, init);
}

async function readMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };

    return typeof body.message === "string" ? body.message : UNAVAILABLE_MESSAGE;
  } catch {
    return UNAVAILABLE_MESSAGE;
  }
}

export async function apiJson<T = undefined>(path: string, init: ApiInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await apiFetch(path, init);
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error;
    }

    throw new ApiError(503, UNAVAILABLE_MESSAGE);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
