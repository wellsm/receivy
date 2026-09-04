import type { HealthResponse } from "@receivy/common";
import { NextResponse } from "next/server";

type UnavailableResponse = {
  status: "unavailable";
};

const unavailable = () =>
  NextResponse.json<UnavailableResponse>(
    { status: "unavailable" },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );

export async function GET() {
  const apiUrl = process.env.EZ4_API_URL;

  if (!apiUrl) {
    return unavailable();
  }

  try {
    const healthUrl = new URL(
      "health",
      apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`,
    );
    const upstream = await fetch(healthUrl, { cache: "no-store" });

    if (!upstream.ok) {
      return unavailable();
    }

    const health = (await upstream.json()) as HealthResponse;

    return NextResponse.json(health, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return unavailable();
  }
}
