import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
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

    redirectToLogin(router);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    expect(router.state.location.search).toEqual({ next: "/nowhere?x=1" });
  });

  it("does nothing when the tab is already on the login", async () => {
    const router = await mountAt("/login");
    const before = router.state.location.href;

    redirectToLogin(router);

    expect(router.state.location.href).toBe(before);
    expect(router.state.location.search).toEqual({});
  });
});
