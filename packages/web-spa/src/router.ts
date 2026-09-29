import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { parseSearch, stringifySearch } from "@/lib/router-search";
import { routeTree } from "@/route-tree.gen";

export function createAppRouter(options?: { history?: RouterHistory }) {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    parseSearch,
    stringifySearch,
    ...(options?.history ? { history: options.history } : {}),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

/** A dead session sends this tab to the login, remembering where it was. */
export function redirectToLogin(router: AppRouter): void {
  if (isLoginPath(router.state.location.pathname)) {
    return;
  }

  void router.navigate({ to: "/login", search: { next: router.state.location.href }, replace: true });
}

/** Logout in another tab: only a page that needs the session leaves; public pages stay where they are. */
export function leaveProtected(router: AppRouter): void {
  const guarded = router.state.matches.some((match) => match.routeId === "/_protected" || match.routeId === "/onboarding");

  if (!guarded) {
    return;
  }

  redirectToLogin(router);
}
