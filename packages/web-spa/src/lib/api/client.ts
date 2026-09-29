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

let refreshInFlight: Promise<boolean> | null = null;

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

    // A network failure here leaves the session alone: it survives an outage, and the caller answers unavailable.
    let response: Response;

    try {
      response = await send("auth/refresh", { auth: false, method: "POST", body: JSON.stringify({ refreshToken }) });
    } catch {
      throw new NetworkError();
    }

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

/** Never rejects on a network failure: it resolves the 503 the old proxy used to answer. */
export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  try {
    const response = await send(path, init);

    if (response.status !== 401 || init.auth === false) {
      return response;
    }

    const refreshed = await refreshSession();

    if (!refreshed) {
      throw new SessionExpiredError();
    }

    return await send(path, init);
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      throw error;
    }

    return unavailableResponse();
  }
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
