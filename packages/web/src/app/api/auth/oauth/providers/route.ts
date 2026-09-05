import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";

export async function GET() {
  try {
    const result = await authApiFetch("auth/oauth/providers", { method: "GET" });
    if (!result.ok) throw new Error("Unavailable");
    const config = await result.json() as { google: boolean; apple: boolean };
    return NextResponse.json({ google: config.google === true, apple: config.apple === true });
  } catch {
    return NextResponse.json({ google: false, apple: false });
  }
}
