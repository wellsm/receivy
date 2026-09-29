import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { clearSession, storeSession } from "@/lib/auth/session";
import { routeTree } from "@/route-tree.gen";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn().mockResolvedValue({ id: "u1", name: "Ana" }),
}));

vi.mock("@/components/screens/login-screen", () => ({
  LoginScreen: ({ nextPath }: { nextPath: string }) => <div data-testid="login-screen">{nextPath}</div>,
}));

function renderAt(path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("login route", () => {
  beforeEach(() => {
    clearSession();
  });

  it("renders the login screen without a session", async () => {
    renderAt("/login");

    expect(await screen.findByTestId("login-screen")).toBeInTheDocument();
  });

  it("redirects to /feed with a session", async () => {
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1", name: "Ana" } } as never);

    const router = renderAt("/login");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));
  });

  it("hands LoginScreen a safe nextPath when next is external", async () => {
    renderAt("/login?next=https://evil");

    expect(await screen.findByTestId("login-screen")).toHaveTextContent("/feed");
  });
});
