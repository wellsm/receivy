import type { SessionTokens } from "@receivy/common";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  authCookieOptions,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from "@/lib/auth/cookies";
import { hasTrustedOrigin } from "@/lib/auth/origin";
import { clearSessionCookies } from "@/lib/auth/response";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
  }

  const store = await cookies();
  const current = store.get(REFRESH_COOKIE)?.value;
  if (!current) {
    return clearSessionCookies(new NextResponse(null, { status: 401 }));
  }

  try {
    const upstream = await authApiFetch("auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: current }),
    });
    if (!upstream.ok) {
      return clearSessionCookies(new NextResponse(null, { status: 401 }));
    }

    const session = (await upstream.json()) as SessionTokens;
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(ACCESS_COOKIE, session.accessToken, authCookieOptions(ACCESS_MAX_AGE));
    response.cookies.set(REFRESH_COOKIE, session.refreshToken, authCookieOptions(REFRESH_MAX_AGE));
    return response;
  } catch {
    return NextResponse.json({ message: "Serviço indisponível." }, { status: 503 });
  }
}
