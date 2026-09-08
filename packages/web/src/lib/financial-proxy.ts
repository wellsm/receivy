import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "./auth/cookies";
import { hasTrustedOrigin } from "./auth/origin";
import { authApiFetch } from "./auth/api";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const ID = "[A-Za-z0-9-]+";
/** Exported only so the OpenAPI contract test can prove every entry maps to a real API operation. */
export const ALLOWED_ROUTES: [string, RegExp][] = [
  ["PATCH", /^account\/profile$/], ["DELETE", /^account$/],
  ["GET", new RegExp(`^charges/${ID}/deliveries$`)], ["POST", new RegExp(`^charges/${ID}/reminders$`)],
  ["GET", /^billings(?:\?.*)?$/], ["POST", /^billings$/], ["GET", new RegExp(`^billings/${ID}(?:/preview)?$`)],
  ["PATCH", new RegExp(`^billings/${ID}$`)],
  ["GET", /^timeline$/],
  ["GET", /^payment-methods$/], ["POST", /^payment-methods$/], ["PATCH", new RegExp(`^payment-methods/${ID}$`)],
  ["POST", new RegExp(`^payment-methods/${ID}/(?:default|archive)$`)],
  ["GET", new RegExp(`^charges/${ID}$`)], ["POST", new RegExp(`^charges/${ID}/(?:cancel|payments|public-link|public-link/rotate)$`)],
  ["DELETE", new RegExp(`^charges/${ID}/public-link$`)], ["GET", new RegExp(`^people/${ID}/ledger$`)],
  ["GET", new RegExp(`^charges/${ID}/proofs$`)], ["POST", new RegExp(`^charges/${ID}/proofs/uploads$`)],
  ["POST", new RegExp(`^charges/${ID}/proofs/uploads/${ID}/finalize$`)],
  ["POST", new RegExp(`^charges/${ID}/proofs/${ID}/(?:review|download)$`)],
];

export function isAllowedFinancialRoute(method: string, path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? "";
  return ALLOWED_ROUTES.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(pathname));
}

export async function financialProxy(request: Request, path: string) {
  if (!isAllowedFinancialRoute(request.method, path)) return new NextResponse(null, { status: 404 });
  if (!SAFE_METHODS.has(request.method) && !hasTrustedOrigin(request)) return new NextResponse(null, { status: 403 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new NextResponse(null, { status: 401 });
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    const upstream = await authApiFetch(path, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
      ...(!SAFE_METHODS.has(request.method) ? { body: await request.text() } : {}),
    });
    if (upstream.status === 204) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Serviço financeiro indisponível. Tente novamente." }, { status: 503 });
  }
}
