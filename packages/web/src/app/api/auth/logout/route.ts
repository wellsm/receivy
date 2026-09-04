import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import { REFRESH_COOKIE } from "@/lib/auth/cookies";
import { hasTrustedOrigin } from "@/lib/auth/origin";
import { clearSessionCookies } from "@/lib/auth/response";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
  }

  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await authApiFetch("auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Browser state must still be cleared when the API is temporarily offline.
    }
  }

  return clearSessionCookies(new NextResponse(null, { status: 204 }));
}
