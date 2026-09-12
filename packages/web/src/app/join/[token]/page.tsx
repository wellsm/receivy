import type { PublicInviteView } from "@receivy/common";
import { needsOnboarding } from "@receivy/common";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { InviteUnavailable, JoinInviteScreen } from "@/components/screens/join-invite-screen";
import { authApiFetch } from "@/lib/auth/api";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { currentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Convite | Receivy", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function JoinInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: PublicInviteView | null = null;

  try {
    const response = await authApiFetch(`public/invites/${encodeURIComponent(token)}`, { method: "GET" });

    if (response.ok) {
      view = await response.json();
    }
  } catch {
    // A missing or unreachable invite falls through to the expired copy below.
  }

  if (!view) {
    return <InviteUnavailable />;
  }

  const authenticated = Boolean((await cookies()).get(ACCESS_COOKIE));

  // The invite names the guest by their profile name: a fresh account finishes onboarding first and comes back here.
  if (authenticated && needsOnboarding(await currentUser())) {
    redirect(`/onboarding?next=${encodeURIComponent(`/join/${token}`)}`);
  }

  return <JoinInviteScreen token={token} view={view} authenticated={authenticated} />;
}
