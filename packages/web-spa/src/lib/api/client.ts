import type { SessionTokens } from "@receivy/common";
import { clearSession, getAccessToken, loadRefreshToken, storeSession } from "@/lib/auth/session";
import { readEnv } from "@/lib/env";
import { ApiError, NetworkError, SessionExpiredError, UNAVAILABLE_MESSAGE } from "./errors";

export { ApiError, NetworkError, SessionExpiredError } from "./errors";

export type ApiInit = RequestInit & {
  /** false for the unauthenticated auth routes: no Bearer, no refresh on 401. */
  auth?: boolean;
  idempotencyKey?: string;
};

/** Two rounds cover a sibling tab that rotated first (409); more than that is a dead session. */
const MAX_REFRESH_ROUNDS = 2;
const STALE_SESSION = 409;

let refreshInFlight: Promise<RefreshOutcome> | null = null;

const unavailable = new WeakSet<Response>();

/** What the old Next proxy answered when the upstream was unreachable: a 503 with a message. */
function unavailableResponse(): Response {
  const response = new Response(JSON.stringify({ message: UNAVAILABLE_MESSAGE }), { status: 503, headers: { "content-type": "application/json" } });

  unavailable.add(response);

  return response;
}

export function isUnavailable(response: Response): boolean {
  return unavailable.has(response);
}

export function apiUrl(path: string): string {
  return `${readEnv().apiUrl}/${path.replace(/^\//, "")}`;
}

async function send(path: string, init: ApiInit): Promise<Response> {
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

  const url = apiUrl(path);

  // Only the request itself failing counts as an outage; anything thrown before it is a bug or a misconfiguration.
  return fetch(url, { ...rest, headers: merged, cache: "no-store" }).catch(() => unavailableResponse());
}

const enum RefreshOutcome {
  Refreshed = "refreshed",
  Expired = "expired",
  Unavailable = "unavailable",
}

async function refreshOnce(): Promise<RefreshOutcome> {
  for (let round = 0; round < MAX_REFRESH_ROUNDS; round++) {
    // Read only now: another tab may have rotated the token while this one waited.
    const refreshToken = loadRefreshToken();

    if (!refreshToken) {
      clearSession();

      return RefreshOutcome.Expired;
    }

    const response = await send("auth/refresh", { auth: false, method: "POST", body: JSON.stringify({ refreshToken }) });

    // The session survives an outage: nothing is cleared, and the caller answers unavailable.
    if (isUnavailable(response)) {
      return RefreshOutcome.Unavailable;
    }

    if (response.ok) {
      storeSession((await response.json()) as SessionTokens);

      return RefreshOutcome.Refreshed;
    }

    // 409: another tab consumed this refresh token moments ago and stored the rotated pair. Retry with it.
    if (response.status !== STALE_SESSION) {
      clearSession();

      return RefreshOutcome.Expired;
    }
  }

  clearSession();

  return RefreshOutcome.Expired;
}

/** One refresh at a time per tab; callers share the promise and its outcome. */
export function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = refreshOnce().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

/** A network failure resolves the 503 the old proxy used to answer instead of rejecting. */
export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const response = await send(path, init);

  if (response.status !== 401 || init.auth === false) {
    return response;
  }

  const outcome = await refreshSession();

  if (outcome === RefreshOutcome.Expired) {
    throw new SessionExpiredError();
  }

  if (outcome === RefreshOutcome.Unavailable) {
    return unavailableResponse();
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
  const response = await apiFetch(path, init);

  if (isUnavailable(response)) {
    throw new NetworkError();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
