import { cookies } from "next/headers";
import { authApiFetch } from "./api";
import { ACCESS_COOKIE } from "./cookies";

/**
 * The charge behind a public token, as the signed-in visitor may open it in the app: null without a
 * session, for a stranger, for a dead link or when the API is unreachable. The public page uses it to
 * send a participant back to their own charge screen after the checkout instead of the public one.
 */
export async function ownChargeIdByToken(token: string): Promise<string | null> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    return null;
  }

  try {
    const upstream = await authApiFetch(`charges/by-link/${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!upstream.ok) {
      return null;
    }

    const payload = (await upstream.json()) as { id: string };

    return payload.id;
  } catch {
    return null;
  }
}
