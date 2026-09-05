import type { AuthSessionResponse } from "@receivy/common";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import { ACCESS_COOKIE, ACCESS_MAX_AGE, REFRESH_COOKIE, REFRESH_MAX_AGE, authCookieOptions } from "@/lib/auth/cookies";
import { OAUTH_COOKIE } from "@/lib/auth/oauth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login?error=oauth", request.url), 303);
  response.cookies.set(OAUTH_COOKIE, "", authCookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  const code = new URL(request.url).searchParams.get("code");
  const codeVerifier = (await cookies()).get(OAUTH_COOKIE)?.value;
  if (!code || !codeVerifier) return response;
  try {
    const upstream = await authApiFetch("auth/oauth/exchange", {
      method: "POST", body: JSON.stringify({ code, codeVerifier, deviceName: "Web" }),
    });
    if (!upstream.ok) return response;
    const session = await upstream.json() as AuthSessionResponse;
    response.cookies.set(ACCESS_COOKIE, session.accessToken, authCookieOptions(ACCESS_MAX_AGE));
    response.cookies.set(REFRESH_COOKIE, session.refreshToken, authCookieOptions(REFRESH_MAX_AGE));
    response.headers.set("Location", new URL("/", request.url).toString());
    return response;
  } catch { return response; }
}
