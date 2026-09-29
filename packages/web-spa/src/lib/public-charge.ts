import type { PublicChargeView } from "@receivy/common";
import { apiFetch } from "@/lib/api/client";
import { hasSession } from "@/lib/auth/session";

export type PublicChargeQuery = { order_nsu?: string; transaction_nsu?: string; slug?: string; returned?: string };

async function readCharge(token: string): Promise<PublicChargeView | null> {
  const response = await apiFetch(`public/charges/${encodeURIComponent(token)}`, { method: "GET", auth: false });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as PublicChargeView;
}

/** The charge behind a public token, as the payer sees it: null for a missing, expired or unreachable link. */
export async function loadPublicCharge(token: string, query: PublicChargeQuery): Promise<PublicChargeView | null> {
  const { order_nsu: orderNsu, transaction_nsu: transactionNsu, slug } = query;

  try {
    if (!orderNsu || !transactionNsu || !slug) {
      return await readCharge(token);
    }

    // Back from InfinitePay: the ids in the url close the charge (after payment_check) before the page renders.
    const response = await apiFetch(`public/charges/${encodeURIComponent(token)}/provider-return`, {
      method: "POST",
      auth: false,
      body: JSON.stringify({ orderNsu, transactionNsu, slug }),
    });

    if (response.ok) {
      return (await response.json()) as PublicChargeView;
    }

    // A refused return (wrong ids, provider down) still shows the charge as it is.
    return await readCharge(token);
  } catch {
    // A missing or unreachable charge falls through to the truthful unavailable state.
    return null;
  }
}

/**
 * The charge behind a public token, as the signed-in visitor may open it in the app: null without a
 * session, for a stranger, for a dead link or when the API is unreachable. The public page uses it to
 * send a participant back to their own charge screen after the checkout instead of the public one.
 */
export async function ownChargeIdByToken(token: string): Promise<string | null> {
  if (!hasSession()) {
    return null;
  }

  try {
    const response = await apiFetch(`charges/by-link/${encodeURIComponent(token)}`, { method: "GET", quietExpiry: true });

    if (!response.ok) {
      return null;
    }

    return ((await response.json()) as { id: string }).id;
  } catch {
    return null;
  }
}
