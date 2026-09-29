import type { SessionTokens } from "@receivy/common";
import { clearSession, getAccessToken, loadRefreshToken, SESSION_STORAGE_KEY, storeSession } from "@/lib/auth/session";
import { readEnv } from "@/lib/env";
import { ApiError, NetworkError, SessionExpiredError, UNAVAILABLE_MESSAGE } from "./errors";

export { ApiError, NetworkError, SessionExpiredError } from "./errors";

export type ApiInit = RequestInit & {
  /** false for the unauthenticated auth routes: no Bearer, no refresh on 401. */
  auth?: boolean;
  idempotencyKey?: string;
  /** true for a public page that only peeks at the session: a dead one still clears and throws, but does not send the tab to the login. */
  quietExpiry?: boolean;
};

/** Two rounds cover a sibling tab that rotated first (409); past that the session is left alone and the call answers unavailable. */
const MAX_REFRESH_ROUNDS = 2;
const STALE_SESSION = 409;
/** How long a 409 waits for the sibling tab to store the rotated pair. */
const ROTATION_WAIT_MS = 3000;
const REFRESH_LOCK = "receivy.session.refresh";

let sessionExpiredHandler: (() => void) | null = null;

/** The app registers what happens to this tab when the session is dead (the login redirect). */
export function onSessionExpired(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

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

  // Ours, not fetch's.
  delete rest.quietExpiry;

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

/** Resolves once the stored refresh token is no longer `previous` (a sibling tab stored its rotated pair), or after the timeout. */
function waitForRotation(previous: string): Promise<void> {
  if (loadRefreshToken() !== previous) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("storage", listener);

      resolve();
    };

    const listener = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SESSION_STORAGE_KEY) {
        return;
      }

      if (loadRefreshToken() !== previous) {
        done();
      }
    };

    const timer = setTimeout(done, ROTATION_WAIT_MS);

    window.addEventListener("storage", listener);
  });
}

async function refreshOnce(): Promise<RefreshOutcome> {
  for (let round = 0; round < MAX_REFRESH_ROUNDS; round++) {
    // Read only now, inside the lock: a sibling tab that rotated first left its pair in storage, and this tab
    // (whose access token lives only in its memory) sends that one.
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

    if (response.status !== STALE_SESSION) {
      clearSession();

      return RefreshOutcome.Expired;
    }

    // 409: a sibling tab consumed this refresh token and may not have stored the rotated pair yet. Never clear
    // here: that would wipe the pair it is about to store. Wait for it, then retry.
    if (round < MAX_REFRESH_ROUNDS - 1) {
      await waitForRotation(refreshToken);
    }
  }

  return RefreshOutcome.Unavailable;
}

/** Serializes the refresh across tabs where the browser has Web Locks; elsewhere the in-tab single flight is all there is. */
function withRefreshLock(task: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;

  if (!locks) {
    return task();
  }

  return locks.request(REFRESH_LOCK, task);
}

/** One refresh at a time per tab; callers share the promise and its outcome. */
export function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = withRefreshLock(refreshOnce).finally(() => {
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
    if (!init.quietExpiry) {
      sessionExpiredHandler?.();
    }

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
