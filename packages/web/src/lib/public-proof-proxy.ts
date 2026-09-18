import { NextResponse } from "next/server";
import { authApiFetch } from "./auth/api";
import { hasTrustedOrigin } from "./auth/origin";

export async function publicProofProxy(request: Request, token: string, path: string) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  // The payer's own slot only: reserve (POST), read its state (GET), take it back (DELETE), confirm the bytes landed or declare a payment (POST).
  const allowed = (path === "proof" && ["POST", "GET", "DELETE"].includes(request.method)) || (["proof/complete", "proof/declaration"].includes(path) && request.method === "POST");

  if (!allowed || !/^[A-Za-z0-9_.-]{1,200}$/.test(token)) {
    return new NextResponse(null, { status: 404, headers });
  }
  if (request.method !== "GET" && !hasTrustedOrigin(request)) {
    return new NextResponse(null, { status: 403, headers });
  }

  try {
    const body = await request.text();

 if (body.length > 4000) {
      return new NextResponse(null, { status: 413, headers });
    }

    const upstream = await authApiFetch(`public/charges/${encodeURIComponent(token)}/${path}`, { method: request.method, ...(request.method !== "GET" ? { body } : {}) });

    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { ...headers, "content-type": "application/json" } });
  } catch { return NextResponse.json({ message: "Não foi possível enviar o comprovante." }, { status: 503, headers }); }
}
