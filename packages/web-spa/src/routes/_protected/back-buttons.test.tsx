import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";
import { stubApi } from "@/test/stub-api";

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

// Every request the screens make on mount, answered with the shape the API sends; anything else is a 404.
function stubScreens(overrides: Parameters<typeof stubApi>[0] = {}) {
  return stubApi({
    "GET /contacts": () => Response.json({ contacts: [], nextCursor: null }),
    "GET /contacts/ana": () => Response.json(ana),
    "GET /contacts/ana/ledger": () =>
      Response.json({
        contactId: "ana",
        contact: ana,
        receivable: { amountCents: 0, currency: "BRL" },
        payable: { amountCents: 0, currency: "BRL" },
        charges: [],
        nextCursor: null,
      }),
    "GET /payment-methods": () => Response.json({ paymentMethods: [] }),
    ...overrides,
  });
}

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));

// The header back button goes one history entry back; its href stays the declared destination,
// which is what a modified click and a pre-hydration click still use.
async function backHref(path: string, settled: () => Promise<unknown>): Promise<string | null> {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  const href = (await screen.findByRole("link", { name: "← Voltar" })).getAttribute("href");

  // Wait for the settled screen itself: a crash would swap the page for the root error boundary.
  await settled();
  expect(screen.queryByText("Algo deu errado")).toBeNull();

  return href;
}

const contactsEmpty = () => screen.findByRole("heading", { name: "Nenhum contato ainda" });
const ledgerLoaded = () => screen.findByText("Nenhuma cobrança concluída ainda.");
const contactForm = () => screen.findByLabelText("Nome completo");
const contactLoaded = () => screen.findByDisplayValue("Ana Souza");
const methodsEmpty = () => screen.findByRole("heading", { name: "Nenhum meio de pagamento" });
// The form starts with the toggle on and turns it off once the answer shows the account already has a method.
const methodFormLoaded = () => waitFor(() => expect(screen.getByLabelText(/Definir como meio principal/)).not.toBeChecked());

describe("back button destinations", () => {
  beforeEach(() => {
    stubScreens();
    clearSession();
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: "Ana", status: "active" } as never);
  });

  it("names the screen the contacts page came from", async () => {
    expect(await backHref("/contacts?returnTo=/billings/new", contactsEmpty)).toBe("/billings/new");
  });

  it("falls back to the profile when the contacts page was opened on its own", async () => {
    expect(await backHref("/contacts", contactsEmpty)).toBe("/settings");
  });

  it("sends the contact history back to the contact list", async () => {
    expect(await backHref("/contacts/ana", ledgerLoaded)).toBe("/contacts");
  });

  it("sends the contact form back to the list, or to the screen that asked for it", async () => {
    expect(await backHref("/contacts/new", contactForm)).toBe("/contacts");

    cleanup();

    expect(await backHref("/contacts/new?returnTo=/billings/new", contactForm)).toBe("/billings/new");
  });

  it("sends the contact edit form back to the contact it came from", async () => {
    expect(await backHref("/contacts/ana/edit", contactLoaded)).toBe("/contacts/ana");
  });

  it("names the screen the payment methods page came from", async () => {
    expect(await backHref("/settings/payment-methods?returnTo=/billings/new&required=1", methodsEmpty)).toBe("/billings/new");
    expect(await screen.findByText("Você precisa de um meio de pagamento para criar cobranças.")).toBeInTheDocument();
  });

  it("falls back to the profile on the payment methods page", async () => {
    expect(await backHref("/settings/payment-methods", methodsEmpty)).toBe("/settings");
  });

  it("sends the payment method form back to the method list", async () => {
    stubScreens({ "GET /payment-methods": () => Response.json({ paymentMethods: [{ id: "m1", archivedAt: null }] }) });

    expect(await backHref("/settings/payment-methods/new", methodFormLoaded)).toBe("/settings/payment-methods");
  });
});
