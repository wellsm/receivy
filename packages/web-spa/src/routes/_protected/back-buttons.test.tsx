import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

const ana = {
  id: "ana",
  userId: "user-ana",
  name: "Ana Souza",
  nickname: null,
  displayName: "Ana Souza",
  email: "ana@example.com",
  phone: null,
  phoneSource: null,
  whatsappConsentAt: null,
  archivedAt: null,
  createdAt: "2026-09-01",
  status: "active",
  lastBilledAt: null,
  activeCharges: 0,
};

// Every request the screens make on mount, answered with the shape the API sends.
function api(url: string): Response {
  const path = new URL(url).pathname;

  if (path === "/contacts/ana/ledger") {
    return Response.json({
      contactId: "ana",
      contact: ana,
      receivable: { amountCents: 0, currency: "BRL" },
      payable: { amountCents: 0, currency: "BRL" },
      charges: [],
      nextCursor: null,
    });
  }

  if (path === "/contacts/ana") {
    return Response.json(ana);
  }

  if (path.startsWith("/payment-methods")) {
    return Response.json({ paymentMethods: [] });
  }

  return Response.json({ contacts: [], nextCursor: null, charges: [] });
}

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));

// The header back button goes one history entry back; its href stays the declared destination,
// which is what a modified click and a pre-hydration click still use.
async function backHref(path: string): Promise<string | null> {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  const href = (await screen.findByRole("link", { name: "← Voltar" })).getAttribute("href");

  // Let the screen's own loading settle: a crash would swap the page for the root error boundary.
  await waitFor(() => expect(screen.queryByText(/carregando/i)).toBeNull());
  expect(screen.queryByText("Algo deu errado")).toBeNull();

  return href;
}

describe("back button destinations", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => api(url)));
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
