import { needsOnboarding } from "@receivy/common";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { currentUser } from "@/lib/auth/flows";
import { hasSession } from "@/lib/auth/session";

export const Route = createFileRoute("/_protected")({
  beforeLoad: ({ location }) => {
    if (!hasSession()) {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
  },
  loader: async ({ location }) => {
    const user = await currentUser();

    // A dead session fails open here: the first apiFetch inside the screen ends it (SessionExpiredError → /login).
    if (user && needsOnboarding(user)) {
      throw redirect({ to: "/onboarding", search: { next: location.href } });
    }

    return { user };
  },
  component: Outlet,
});
