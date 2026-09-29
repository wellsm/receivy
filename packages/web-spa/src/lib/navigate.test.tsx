import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { useAppNavigate } from "./navigate";

function Jump({ to }: { to: string }) {
  const navigate = useAppNavigate();

  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);

  return null;
}

function renderJump(to: string) {
  const root = createRootRoute({ component: Outlet });
  const start = createRoute({ getParentRoute: () => root, path: "/", component: () => <Jump to={to} /> });
  const feed = createRoute({ getParentRoute: () => root, path: "/feed", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([start, feed]), history: createMemoryHistory({ initialEntries: ["/"] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("useAppNavigate", () => {
  it("keeps search when the target carries a query string", async () => {
    const router = renderJump("/feed?x=1#h");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(router.state.location.searchStr).toContain("x=1");
    expect(router.state.location.hash).toBe("h");
  });

  it("navigates to a plain path", async () => {
    const router = renderJump("/feed");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(router.state.location.searchStr).toBe("");
  });
});
