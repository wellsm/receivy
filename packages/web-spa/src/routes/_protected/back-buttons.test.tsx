import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));

// The header back button goes one history entry back; its href stays the declared destination,
// which is what a modified click and a pre-hydration click still use.
async function backHref(path: string): Promise<string | null> {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return (await screen.findByRole("link", { name: "← Voltar" })).getAttribute("href");
}

describe("back button destinations", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("payment-methods") ? Response.json({ paymentMethods: [] }) : Response.json({ contacts: [], nextCursor: null, charges: [] }),
      ),
    );
    clearSession();
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: "Ana", status: "active" } as never);
  });

  it("names the screen the contacts page came from", async () => {
    expect(await backHref("/contacts?returnTo=/billings/new")).toBe("/billings/new");
  });

  it("falls back to the profile when the contacts page was opened on its own", async () => {
    expect(await backHref("/contacts")).toBe("/settings");
  });

  it("sends the contact history back to the contact list", async () => {
    expect(await backHref("/contacts/ana")).toBe("/contacts");
  });

  it("sends the contact form back to the list, or to the screen that asked for it", async () => {
    expect(await backHref("/contacts/new")).toBe("/contacts");

    cleanup();

    expect(await backHref("/contacts/new?returnTo=/billings/new")).toBe("/billings/new");
  });

  it("sends the contact edit form back to the contact it came from", async () => {
    expect(await backHref("/contacts/ana/edit")).toBe("/contacts/ana");
  });

  it("names the screen the payment methods page came from", async () => {
    expect(await backHref("/settings/payment-methods?returnTo=/billings/new&required=1")).toBe("/billings/new");
    expect(await screen.findByText("Você precisa de um meio de pagamento para criar cobranças.")).toBeInTheDocument();
  });

  it("falls back to the profile on the payment methods page", async () => {
    expect(await backHref("/settings/payment-methods")).toBe("/settings");
  });

  it("sends the payment method form back to the method list", async () => {
    expect(await backHref("/settings/payment-methods/new")).toBe("/settings/payment-methods");
  });
});
