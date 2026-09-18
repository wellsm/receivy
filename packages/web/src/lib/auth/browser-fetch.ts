let refreshInFlight: Promise<Response> | null = null;

/** Two rounds cover a sibling window that rotated first; more than that is a dead session. */
const MAX_REFRESH_ROUNDS = 2;

function refreshSession(): Promise<Response> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST" }).finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

// Browser requests stay on the BFF. API tokens remain in HttpOnly cookies.
export async function browserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(path, { ...init, cache: "no-store" });
  let response = await send();

  for (let round = 0; response.status === 401 && round < MAX_REFRESH_ROUNDS; round++) {
    const refreshed = await refreshSession();

    // 409 means another window consumed the refresh token moments ago, so the cookie jar already
    // holds the rotated pair: the retry below carries it and the session survives the race.
    if (!refreshed.ok && refreshed.status !== 409) {
      // This transport runs outside React; reload after clearing expired cookies.
      window.location.replace(new URL("/login", window.location.origin).href);

      throw new Error("Sua sessão expirou. Entre novamente.");
    }

    response = await send();
  }

  return response;
}
