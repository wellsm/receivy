import type { AuthSessionResponse } from "@receivy/common";
import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  authCookieOptions,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from "./cookies";

export function sessionResponse(session: AuthSessionResponse): NextResponse {
  const response = NextResponse.json({
    expiresIn: session.expiresIn,
    user: session.user,
  });
  response.cookies.set(
    ACCESS_COOKIE,
    session.accessToken,
    authCookieOptions(ACCESS_MAX_AGE),
  );
  response.cookies.set(
    REFRESH_COOKIE,
    session.refreshToken,
    authCookieOptions(REFRESH_MAX_AGE),
  );
  return response;
}

export function clearSessionCookies(response: NextResponse): NextResponse {
  response.cookies.set(ACCESS_COOKIE, "", authCookieOptions(0));
  response.cookies.set(REFRESH_COOKIE, "", authCookieOptions(0));
  return response;
}
