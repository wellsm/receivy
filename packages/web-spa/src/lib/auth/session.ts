import type { SessionTokens } from "@receivy/common";

export const SESSION_STORAGE_KEY = "receivy.session";

// The access token never leaves memory; only the refresh token is persisted.
let accessToken: string | null = null;

/** Storage can throw (private mode, blocked cookies): treat that as no session. */
function withStorage<T>(fallback: T, task: () => T): T {
  try {
    return task();
  } catch {
    return fallback;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function loadRefreshToken(): string | null {
  const raw = withStorage(null, () => localStorage.getItem(SESSION_STORAGE_KEY));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { refreshToken?: unknown } | null;
    const refreshToken = parsed?.refreshToken;

    return typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null;
  } catch {
    return null;
  }
}

export function hasSession(): boolean {
  return loadRefreshToken() !== null;
}

export function storeSession(tokens: SessionTokens): void {
  accessToken = tokens.accessToken;

  withStorage(undefined, () => localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ refreshToken: tokens.refreshToken })));
}

export function clearSession(): void {
  accessToken = null;

  withStorage(undefined, () => localStorage.removeItem(SESSION_STORAGE_KEY));
}

/** Logout (or a dead session) in another tab ends this one too. Returns the unsubscribe. */
export function watchSessionRemoval(onRemoved: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === SESSION_STORAGE_KEY && event.newValue === null) {
      accessToken = null;

      onRemoved();
    }
  };

  window.addEventListener("storage", listener);

  return () => {
    window.removeEventListener("storage", listener);
  };
}
