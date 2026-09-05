import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import { authCookieOptions } from "@/lib/auth/cookies";
import { hasTrustedOrigin } from "@/lib/auth/origin";
import { isProviderAuthorizationUrl, OAUTH_COOKIE } from "@/lib/auth/oauth";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return new NextResponse(null, { status: 403 });
  try {
    const { provider } = await request.json() as { provider: unknown };
    if (provider !== "google" && provider !== "apple") return new NextResponse(null, { status: 400 });
    const verifier = randomBytes(32).toString("base64url");
    const result = await authApiFetch("auth/oauth/start", {
      method: "POST",
      body: JSON.stringify({ provider,
        destination: new URL("/auth/oauth/callback", request.url).toString(),
        clientChallenge: createHash("sha256").update(verifier).digest("base64url"),
      }),
    });
    if (!result.ok) throw new Error("Unavailable");
    const { authorizationUrl } = await result.json() as { authorizationUrl: unknown };
    if (!isProviderAuthorizationUrl(authorizationUrl, provider)) throw new Error("Invalid URL");
    const response = NextResponse.json({ authorizationUrl });
    response.cookies.set(OAUTH_COOKIE, verifier, authCookieOptions(600));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ message: "Não foi possível iniciar o login. Tente novamente." }, { status: 503 });
  }
}
