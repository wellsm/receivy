import type { PublicLink } from "@receivy/common";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authApiFetch } from "@/lib/auth/api";

export const metadata: Metadata = { title: "Cobrança | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Where the short link lands: the signed token it stands for, read server-side. */
async function tokenOf(code: string): Promise<string | null> {
  try {
    const response = await authApiFetch(`public/short/${encodeURIComponent(code)}`, { method: "GET" });

    if (!response.ok) {
      return null;
    }

    return ((await response.json()) as PublicLink).token;
  } catch {
    return null;
  }
}

/**
 * `/p/<code>` is what the notices print: short enough for a WhatsApp message. It opens the same
 * `/pay/<token>` page the signed link does. An unknown, revoked or expired code goes there too, and
 * the pay page shows its "Link indisponível" state, so that copy lives in one place.
 */
export default async function ShortLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = await tokenOf(code);

  redirect(`/pay/${encodeURIComponent(token ?? code)}`);
}
