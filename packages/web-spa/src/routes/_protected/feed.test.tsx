import { currentMonth, type ListCharge } from "@receivy/common";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { apiJson } from "@/lib/api/client";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiJson: vi.fn() }));
vi.mock("@/components/screens/feed-screen", () => ({
  FeedScreen: ({ charges, month, user }: { charges: { id: string }[]; month: string; user: { name: string } }) => (
    <div data-testid="feed-screen">{`${month}|${charges.map((charge) => charge.id).join(",")}|${user.name}`}</div>
  ),
}));

const user = { id: "u1", name: "Ana", status: "active" };

function charge(id: string, type: string) {
  return { id, type, state: "pending", dueDate: "2026-09-10", billing: { recurrence: "single" } };
}

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("feed route", () => {
  beforeEach(() => {
    clearSession();
    storeSession({ accessToken: "a", refreshToken: "r", user } as never);
    vi.mocked(currentUser).mockResolvedValue(user as never);
    vi.mocked(apiJson).mockResolvedValue([] as never);
  });

  it("falls back to the current month when the month is not valid", async () => {
    renderAt("/feed?month=2026-13");

    const screenNode = await screen.findByTestId("feed-screen");

    expect(apiJson).toHaveBeenCalledWith(`charges?month=${currentMonth()}`);
    expect(screenNode).toHaveTextContent(`${currentMonth()}|`);
  });

  it("requests the month named in the URL", async () => {
    renderAt("/feed?month=2026-09");

    await screen.findByTestId("feed-screen");

    expect(apiJson).toHaveBeenCalledWith("charges?month=2026-09");
  });

  it("hands the screen the user, the month and the filtered charges", async () => {
    vi.mocked(apiJson).mockResolvedValue([charge("c1", "receivable"), charge("c2", "payable")] as unknown as ListCharge as never);

    renderAt("/feed?month=2026-09&direction=payable");

    expect(await screen.findByTestId("feed-screen")).toHaveTextContent("2026-09|c2|Ana");
  });

  it("shows an empty feed when the charges cannot be loaded", async () => {
    vi.mocked(apiJson).mockRejectedValue(new Error("down"));

    renderAt("/feed?month=2026-09");

    expect(await screen.findByTestId("feed-screen")).toHaveTextContent("2026-09||Ana");
  });
});
