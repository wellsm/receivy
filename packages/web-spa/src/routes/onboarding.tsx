import { needsOnboarding } from "@receivy/common";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";
import { currentUser } from "@/lib/auth/flows";
import { safeNextPath } from "@/lib/auth/next-path";
import { hasSession } from "@/lib/auth/session";

type OnboardingSearch = { next?: string };

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => (typeof search.next === "string" ? { next: search.next } : {}),
  beforeLoad: ({ search }) => {
    if (!hasSession()) {
      throw redirect({ to: "/login", search: { next: search.next } });
    }
  },
  loader: async ({ location }) => {
    const user = await currentUser();
    const nextPath = safeNextPath(new URLSearchParams(location.searchStr).get("next"));

    if (user && !needsOnboarding(user)) {
      throw redirect({ to: nextPath });
    }

    return { user };
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user } = Route.useLoaderData();
  const { next } = Route.useSearch();

  return (
    <main className="flex min-h-dvh flex-col justify-center bg-canvas px-6 py-8 md:px-8 md:py-16">
      <OnboardingScreen nextPath={safeNextPath(next ?? null)} initialName={user?.name} />
    </main>
  );
}
