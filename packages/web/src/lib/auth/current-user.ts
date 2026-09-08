import type { AuthUser } from "@receivy/common";
import { cookies } from "next/headers";
import { authApiFetch } from "./api";
import { ACCESS_COOKIE } from "./cookies";

/**
 * Resolves the signed-in profile during a server render. Returns null whenever
 * the session cannot be established (no access cookie, rejected token or API
 * unavailable): callers must fail open and let the client transport refresh or
 * sign out, because a server component cannot rewrite cookies to break a loop.
 */
export async function currentUser(): Promise<AuthUser | null> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    return null;
  }

  try {
    const upstream = await authApiFetch("auth/me", {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!upstream.ok) {
      return null;
    }

    const payload = (await upstream.json()) as { user: AuthUser };

    return payload.user;
  } catch {
    return null;
  }
}
