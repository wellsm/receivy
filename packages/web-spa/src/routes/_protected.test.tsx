import { needsOnboarding, UserStatus } from "@receivy/common";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn(),
}));

vi.mock("@/components/screens/login-screen", () => ({ LoginScreen: () => <div>login</div> }));
vi.mock("@/components/screens/onboarding-screen", () => ({ OnboardingScreen: () => <div>onboarding</div> }));

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("protected layout", () => {
  beforeEach(() => {
    clearSession();
  });

  it("sends a visitor without a session to /login carrying next", async () => {
    const router = renderAt("/feed");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    expect(router.state.location.search).toEqual({ next: "/feed" });
  });

  it("sends an unnamed profile to /onboarding carrying next", async () => {
    // A pending profile: the person has not confirmed name and phone yet.
    const pending = { id: "u1", name: null, status: UserStatus.Pending };

    expect(needsOnboarding(pending)).toBe(true);

    storeSession({ accessToken: "a", refreshToken: "r", user: pending } as never);
    vi.mocked(currentUser).mockResolvedValue(pending as never);

    const router = renderAt("/feed");

    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"));

    expect(router.state.location.search).toEqual({ next: "/feed" });
  });
});
