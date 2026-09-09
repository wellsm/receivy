import type { SessionTokens } from "@receivy/common";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  authCookieOptions,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  safeNextPath,
} from "@/lib/auth/cookies";
import { clearSessionCookies } from "@/lib/auth/response";
import { proofUploadOrigin } from "@/lib/proof-origin";
import { appUrl } from "@/lib/app-url";

function loginRedirect(request: NextRequest): NextResponse {
  const login = appUrl(request, "/login");
  const { pathname, search } = request.nextUrl;

  login.searchParams.set("next", safeNextPath(`${pathname}${search}`));

  return NextResponse.redirect(login);
}

/**
 * The proxy is the only step that runs before every server render and may
 * still write cookies, so an expired access cookie is refreshed here (Rewarlo
 * pattern). Server components then see the rotated tokens through the
 * forwarded cookie header. A rejected refresh signs the browser out; an
 * unreachable API lets the page render so the client transport can retry.
 */
async function refreshSession(request: NextRequest, refreshToken: string): Promise<NextResponse> {
  try {
    const upstream = await authApiFetch("auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });

    if (!upstream.ok) {
      return clearSessionCookies(loginRedirect(request));
    }

    const session = (await upstream.json()) as SessionTokens;
    const response = NextResponse.next();

    response.cookies.set(ACCESS_COOKIE, session.accessToken, authCookieOptions(ACCESS_MAX_AGE));
    response.cookies.set(REFRESH_COOKIE, session.refreshToken, authCookieOptions(REFRESH_MAX_AGE));

    return response;
  } catch {
    return NextResponse.next();
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const hasSession = Boolean(accessToken || refreshToken);
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/pay/")) {
    const nonce = crypto.randomUUID();
    const uploadOrigin = proofUploadOrigin(process.env.PROOF_UPLOAD_ORIGIN);
    const csp = ["default-src 'self'", `script-src 'nonce-${nonce}' 'strict-dynamic'`, "style-src 'self'", "img-src 'self' data:", "font-src 'self'", `connect-src 'self'${uploadOrigin ? ` ${uploadOrigin}` : ""}`, "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"].join("; ");
    const requestHeaders = new Headers(request.headers); requestHeaders.set("content-security-policy", csp); requestHeaders.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("content-security-policy", csp); response.headers.set("cache-control", "private, no-store"); response.headers.set("referrer-policy", "no-referrer"); response.headers.set("x-content-type-options", "nosniff"); response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }

  // The invite page is public and renders no upload surface, so it only needs
  // the private cache and the crawler opt-out.
  if (pathname.startsWith("/join/")) {
    const response = NextResponse.next();

    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-robots-tag", "noindex");

    return response;
  }

  if (pathname === "/login" || pathname === "/login/code") {
    if (hasSession) {
      return NextResponse.redirect(appUrl(request, "/"));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    return loginRedirect(request);
  }

  if (!accessToken && refreshToken) {
    return refreshSession(request, refreshToken);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/login/code", "/onboarding", "/charges/:path*", "/pay/:path*", "/join/:path*", "/people/:path*", "/billings/:path*", "/settings/:path*"],
};
