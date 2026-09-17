import { cookies } from "next/headers";
import { authApiFetch } from "./api";
import { ACCESS_COOKIE } from "./cookies";

/**
 * Server-side call to the API on behalf of the signed-in visitor: the proxy keeps the access cookie
 * fresh, this attaches it. Without a cookie the request goes out unauthenticated on purpose, so the
 * API decides instead of the caller guessing; a server component cannot rewrite cookies anyway.
 */
export async function sessionApiFetch<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;

  const response = await authApiFetch(path, {
    ...init,
    headers: {
      ...init.headers,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<T>;
}
