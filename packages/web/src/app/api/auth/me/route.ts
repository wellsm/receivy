import type { AuthUser } from "@receivy/common";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";

export async function GET() {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const upstream = await authApiFetch("auth/me", {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status === 401 ? 401 : 503 });
    }
    return NextResponse.json((await upstream.json()) as { user: AuthUser });
  } catch {
    return NextResponse.json({ message: "Serviço indisponível." }, { status: 503 });
  }
}
