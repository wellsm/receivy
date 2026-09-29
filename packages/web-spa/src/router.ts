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

/** A dead session sends this tab to the login, remembering where it was. */
export function redirectToLogin(router: AppRouter): void {
  if (router.state.location.pathname.startsWith("/login")) {
    return;
  }

  void router.navigate({ to: "/login", search: { next: router.state.location.href }, replace: true });
}
