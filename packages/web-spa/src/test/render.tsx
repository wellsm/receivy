import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { parseSearch, stringifySearch } from "@/lib/router-search";

type RenderWithRouterOptions = {
  path?: string;
  search?: Record<string, string | undefined>;
};

function withSearch(path: string, search?: Record<string, string | undefined>): string {
  if (!search) {
    return path;
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }

  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

/**
 * Renders `ui` inside a real TanStack Router, so a screen using `Link`, `useNavigate` or
 * `useLocation` behaves the same as it does in the app. The router has exactly one route,
 * a splat mounted at the root that renders `ui` whatever the path, and its memory history
 * starts at `options.path` (`/` by default).
 */
export function renderWithRouter(ui: ReactNode, options: RenderWithRouterOptions = {}) {
  const rootRoute = createRootRoute();
  const catchAllRoute = createRoute({ getParentRoute: () => rootRoute, path: "$", component: () => ui });

  const router = createRouter({
    routeTree: rootRoute.addChildren([catchAllRoute]),
    parseSearch,
    stringifySearch,
    history: createMemoryHistory({ initialEntries: [withSearch(options.path ?? "/", options.search)] }),
  });

  const result = render(<RouterProvider router={router} />);

  return { ...result, router };
}
