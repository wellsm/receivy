import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { clearSession, storeSession } from "@/lib/auth/session";
import { stubApi } from "@/test/stub-api";
import { createAppRouter, leaveProtected, redirectToLogin } from "./router";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn(),
}));

vi.mock("@/components/screens/login-screen", () => ({ LoginScreen: () => <div>login</div> }));
// The code screen sends a visitor without a pending e-mail back to the login by itself.
vi.mock("@/components/screens/code-screen", () => ({ CodeScreen: () => <div>code</div> }));
vi.mock("@/components/screens/billings-screen", () => ({ BillingsScreen: () => <div>billings</div> }));
vi.mock("@/components/app/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

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

  it("does not take a path that only starts with /login for the login", async () => {
    const router = await mountAt("/loginx");

    await act(async () => {
      redirectToLogin(router);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    expect(router.state.location.search).toEqual({ next: "/loginx" });
  });
});

describe("leaveProtected", () => {
  beforeEach(() => {
    clearSession();
    stubApi({});
  });

  it("sends a protected page to the login, keeping where it was", async () => {
    storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });

    const router = await mountAt("/billings");

    expect(router.state.location.pathname).toBe("/billings");

    clearSession();

    await act(async () => {
      leaveProtected(router);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    expect(router.state.location.search).toEqual({ next: "/billings" });
  });

  it.each(["/pay/tok", "/join/tok", "/opt-out/tok", "/privacy", "/login/code"])("leaves the visitor of %s where they are", async (path) => {
    const router = await mountAt(path);
    const navigate = vi.spyOn(router, "navigate");

    await act(async () => {
      leaveProtected(router);
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(path);
  });
});
