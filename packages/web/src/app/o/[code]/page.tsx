import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authApiFetch } from "@/lib/auth/api";

export const metadata: Metadata = { title: "Avisos | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The account's opt-out token behind the code, read server-side. */
async function tokenOf(code: string): Promise<string | null> {
  try {
    const response = await authApiFetch(`public/opt-out/short/${encodeURIComponent(code)}`, { method: "GET" });

    if (!response.ok) {
      return null;
    }

    return ((await response.json()) as { token: string }).token;
  } catch {
    return null;
  }
}

/**
 * `/o/<code>` is the opt-out link the notices print. It opens the same `/opt-out/<token>` page the
 * signed link does, which still asks for the click. An unknown code goes there too, and that page
 * shows its invalid-link state, so the copy lives in one place.
 */
export default async function OptOutShortLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = await tokenOf(code);

  redirect(`/opt-out/${encodeURIComponent(token ?? code)}`);
}
