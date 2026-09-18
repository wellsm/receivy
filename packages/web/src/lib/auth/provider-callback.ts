import { NextResponse } from "next/server";
import { authApiUrl } from "./api";
import { appUrl } from "../app-url";

const MAX_FORM_BYTES = 32 * 1024;

/**
 * Sign in with Apple (and Google, for symmetry) call back on the web domain,
 * because Apple only accepts a verifiable HTTPS domain and the EZ4 API lives on
 * an API Gateway URL. This thin bridge forwards the provider response untouched
 * to `${EZ4_API_URL}/auth/<provider>/callback` and relays the API's 302, whose
 * destination the API already restricted to OAUTH_REDIRECT_ALLOW_LIST (the web
 * `/auth/oauth/callback` or `receivy://auth/callback`). Anything that is not a
 * redirect becomes a generic login error: provider and API bodies never reach
 * the browser.
 */
export async function relayProviderCallback(request: Request, provider: "google" | "apple"): Promise<Response> {
  const failure = NextResponse.redirect(appUrl(request, "/login?error=oauth"), 303);

  failure.headers.set("Cache-Control", "no-store");
  failure.headers.set("Referrer-Policy", "no-referrer");

  try {
    const target = authApiUrl(`auth/${provider}/callback`);
    let upstream: Response;

    if (provider === "google") {
      target.search = new URL(request.url).search;
      upstream = await fetch(target, { method: "GET", redirect: "manual", cache: "no-store" });
    } else {
      const body = await request.text();

      if (body.length > MAX_FORM_BYTES) {
        return failure;
      }

      upstream = await fetch(target, {
        method: "POST", redirect: "manual", cache: "no-store", body,
        headers: { "content-type": request.headers.get("content-type") ?? "application/x-www-form-urlencoded" },
      });
    }

    const location = upstream.headers.get("location");

    if (upstream.status < 300 || upstream.status >= 400 || !location) {
      return failure;
    }

    const relayed = new NextResponse(null, { status: 303, headers: { location } });

    relayed.headers.set("Cache-Control", "no-store");
    relayed.headers.set("Referrer-Policy", "no-referrer");

    return relayed;
  } catch {
    return failure;
  }
}
