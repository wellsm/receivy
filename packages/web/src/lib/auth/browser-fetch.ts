let refreshInFlight: Promise<Response> | null = null;

// Browser requests stay on the BFF. API tokens remain in HttpOnly cookies.
export async function browserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(path, { ...init, cache: "no-store" });
  let response = await send();
  if (response.status === 401) {
    if (!refreshInFlight) refreshInFlight = fetch("/api/auth/refresh", { method: "POST" })
      .finally(() => { refreshInFlight = null; });
    const refreshed = await refreshInFlight;
    if (!refreshed.ok) {
      // This transport runs outside React; reload after clearing expired cookies.
      window.location.replace(new URL("/login", window.location.origin).href);
      throw new Error("Sua sessão expirou. Entre novamente.");
    }
    response = await send();
  }
  return response;
}
