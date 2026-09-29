import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { useAppNavigate } from "./navigate";

function Jump({ to, resetScroll }: { to: string; resetScroll?: boolean }) {
  const navigate = useAppNavigate();

  useEffect(() => {
    navigate(to, { replace: true, resetScroll });
  }, [navigate, to, resetScroll]);

  return null;
}

function renderJump(to: string, resetScroll?: boolean) {
  const root = createRootRoute({ component: Outlet });
  const start = createRoute({ getParentRoute: () => root, path: "/", component: () => <Jump to={to} resetScroll={resetScroll} /> });
  const feed = createRoute({ getParentRoute: () => root, path: "/feed", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([start, feed]), history: createMemoryHistory({ initialEntries: ["/"] }) });

  const navigate = vi.spyOn(router, "navigate");

  render(<RouterProvider router={router} />);

  return { router, navigate };
}

describe("useAppNavigate", () => {
  it("keeps search when the target carries a query string", async () => {
    const { router } = renderJump("/feed?x=1#h");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(router.state.location.searchStr).toContain("x=1");
    expect(router.state.location.hash).toBe("h");
  });

  it("navigates to a plain path", async () => {
    const { router } = renderJump("/feed");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(router.state.location.searchStr).toBe("");
  });

  it("forwards resetScroll to the router", async () => {
    const { router, navigate } = renderJump("/feed?x=1", false);

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ href: "/feed?x=1", replace: true, resetScroll: false }));
  });
});
