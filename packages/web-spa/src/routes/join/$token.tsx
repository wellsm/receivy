import { needsOnboarding, type PublicInviteView } from "@receivy/common";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { InviteUnavailable, JoinInviteScreen } from "@/components/screens/join-invite-screen";
import { apiJson } from "@/lib/api/client";
import { currentUser } from "@/lib/auth/flows";
import { hasSession } from "@/lib/auth/session";

export const Route = createFileRoute("/join/$token")({
  loader: async ({ params }) => {
    // A missing or unreachable invite falls through to the expired copy.
    const view = await apiJson<PublicInviteView>(`public/invites/${encodeURIComponent(params.token)}`, { auth: false }).catch(() => null);

    if (!view) {
      return { view: null, authenticated: false };
    }

    const authenticated = hasSession();

    // The invite names the guest by their profile name: a fresh account finishes onboarding first and comes back here.
    if (authenticated && needsOnboarding(await currentUser())) {
      throw redirect({ to: "/onboarding", search: { next: `/join/${params.token}` } });
    }

    return { view, authenticated };
  },
  head: () => ({ meta: [{ title: "Convite | Receivy" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useParams();
  const { view, authenticated } = Route.useLoaderData();

  if (!view) {
    return <InviteUnavailable />;
  }

  return <JoinInviteScreen token={token} view={view} authenticated={authenticated} />;
}
