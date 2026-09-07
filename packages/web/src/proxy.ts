import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, safeNextPath } from "@/lib/auth/cookies";

export function proxy(request: NextRequest) {
  const hasSession = Boolean(
    request.cookies.get(ACCESS_COOKIE)?.value ||
    request.cookies.get(REFRESH_COOKIE)?.value,
  );
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/pay/")) {
    const nonce = crypto.randomUUID();
    const csp = ["default-src 'self'", `script-src 'nonce-${nonce}' 'strict-dynamic'`, "style-src 'self'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"].join("; ");
    const requestHeaders = new Headers(request.headers); requestHeaders.set("content-security-policy", csp); requestHeaders.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("content-security-policy", csp); response.headers.set("cache-control", "private, no-store"); response.headers.set("referrer-policy", "no-referrer"); response.headers.set("x-content-type-options", "nosniff"); response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  }

  if (pathname === "/login") {
    if (hasSession) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set(
      "next",
      safeNextPath(`${pathname}${request.nextUrl.search}`),
    );
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/charges/:path*", "/pay/:path*", "/people/:path*", "/recurrences/:path*", "/settings/:path*"],
};
