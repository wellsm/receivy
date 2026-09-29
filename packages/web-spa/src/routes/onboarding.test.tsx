import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { routeTree } from "@/route-tree.gen";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn(),
}));

vi.mock("@/components/screens/login-screen", () => ({ LoginScreen: () => <div>login</div> }));
vi.mock("@/components/screens/onboarding-screen", () => ({
  OnboardingScreen: ({ nextPath }: { nextPath: string }) => <div data-testid="onboarding-screen">{nextPath}</div>,
}));

function renderAt(path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

function signIn(name: string | null, status: string) {
  storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1", name, status } } as never);
  vi.mocked(currentUser).mockResolvedValue({ id: "u1", name, status } as never);
}

describe("onboarding route", () => {
  beforeEach(() => {
    clearSession();
  });

  it("sends a visitor without a session to /login", async () => {
    const router = renderAt("/onboarding");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("keeps search of next when the profile is already complete", async () => {
    signIn("Ana", "active");

    const router = renderAt("/onboarding?next=%2Ffeed%3Fx%3D1%23h");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(router.state.location.search).toEqual({ x: 1 });
    expect(router.state.location.hash).toBe("h");
  });

  it("ignores an external next when the profile is already complete", async () => {
    signIn("Ana", "active");

    const router = renderAt("/onboarding?next=https://evil");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));
  });

  it("renders the screen with a safe nextPath when the profile needs onboarding", async () => {
    signIn(null, "pending");

    renderAt("/onboarding?next=https://evil");

    expect(await screen.findByTestId("onboarding-screen")).toHaveTextContent("/feed");
  });
});
