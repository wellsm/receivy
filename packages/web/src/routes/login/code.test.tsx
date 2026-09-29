import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn().mockResolvedValue({ id: "u1", name: "Ana" }),
}));

vi.mock("@/components/screens/code-screen", () => ({ CodeScreen: () => <div data-testid="code-screen" /> }));

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("login code route", () => {
  beforeEach(() => {
    clearSession();
  });

  it("renders the code screen without a session", async () => {
    renderAt("/login/code");

    expect(await screen.findByTestId("code-screen")).toBeInTheDocument();
  });

  it("redirects to /feed with a session", async () => {
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1", name: "Ana" } } as never);

    const router = renderAt("/login/code");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));
  });
});
