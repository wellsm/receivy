import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, waitFor } from "@testing-library/react";
import { clearSession } from "@/lib/auth/session";
import { createAppRouter, redirectToLogin } from "./router";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn(),
}));

vi.mock("@/components/screens/login-screen", () => ({ LoginScreen: () => <div>login</div> }));

async function mountAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));

  return router;
}

describe("redirectToLogin", () => {
  beforeEach(() => {
    clearSession();
  });

  it("goes to /login carrying where the tab was", async () => {
    // An unknown path renders the not-found page, so no route guard interferes.
    const router = await mountAt("/nowhere?x=1");
    const navigate = vi.spyOn(router, "navigate");

    await act(async () => {
      redirectToLogin(router);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/login", search: { next: "/nowhere?x=1" }, replace: true });
    expect(router.state.location.search).toEqual({ next: "/nowhere?x=1" });
  });

  it("does nothing when the tab is already on the login", async () => {
    const router = await mountAt("/login?next=/feed");
    const navigate = vi.spyOn(router, "navigate");

    await act(async () => {
      redirectToLogin(router);
      await router.load();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/feed" });
  });
});
