import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));
vi.mock("@/components/screens/charge-detail-screen", () => ({
  ChargeDetailScreen: ({ id, returned }: { id: string; returned: boolean }) => <div data-testid="charge-screen">{`${id}|${String(returned)}`}</div>,
}));
vi.mock("@/components/screens/proof-viewer-screen", () => ({
  ProofViewerScreen: ({ chargeId }: { chargeId: string }) => <div data-testid="proof-screen">{chargeId}</div>,
}));

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("charge routes", () => {
  beforeEach(() => {
    clearSession();
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: "Ana", status: "active" } as never);
  });

  it("passes returned true when the payment provider sent the visitor back", async () => {
    renderAt("/charges/c1?returned=1");

    expect(await screen.findByTestId("charge-screen")).toHaveTextContent("c1|true");
  });

  it("passes returned false without the mark", async () => {
    renderAt("/charges/c1");

    expect(await screen.findByTestId("charge-screen")).toHaveTextContent("c1|false");
  });

  it("renders the proof viewer, not the charge, on /charges/:id/proof", async () => {
    renderAt("/charges/c1/proof");

    expect(await screen.findByTestId("proof-screen")).toHaveTextContent("c1");
    expect(screen.queryByTestId("charge-screen")).not.toBeInTheDocument();
  });
});
