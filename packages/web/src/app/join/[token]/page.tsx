import type { PublicInviteView } from "@receivy/common";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { JoinInvite } from "@/components/join-invite";
import { authApiFetch } from "@/lib/auth/api";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";

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
    return (
      <main className="public-charge public-invite">
        <div className="public-brand">Receivy</div>
        <section>
          <h1>Convite indisponível</h1>
          <p className="invite-expired">Convite expirado. Peça um novo link.</p>
        </section>
      </main>
    );
  }

  const authenticated = Boolean((await cookies()).get(ACCESS_COOKIE));

  return <JoinInvite token={token} view={view} authenticated={authenticated} />;
}
