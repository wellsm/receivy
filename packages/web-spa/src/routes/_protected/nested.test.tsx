import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { currentUser } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));
vi.mock("@/components/screens/billing-detail-screen", () => ({ BillingDetailScreen: ({ id }: { id: string }) => <div>{`billing detail ${id}`}</div> }));
vi.mock("@/components/screens/billing-edit-screen", () => ({ BillingEditScreen: ({ id }: { id: string }) => <div>{`billing edit ${id}`}</div> }));
vi.mock("@/components/screens/contact-ledger-screen", () => ({ ContactLedgerScreen: ({ id }: { id: string }) => <div>{`contact ledger ${id}`}</div> }));
vi.mock("@/components/forms/contact-form-screen", () => ({
  ContactFormScreen: ({ contactId }: { contactId?: string }) => <div>{`contact form ${contactId ?? "new"}`}</div>,
}));
vi.mock("@/components/screens/payment-methods-screen", () => ({ PaymentMethodsScreen: () => <div>payment methods list</div> }));
vi.mock("@/components/forms/payment-method-form-screen", () => ({ PaymentMethodFormScreen: () => <div>payment method form</div> }));

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

describe("nested protected routes", () => {
  beforeEach(() => {
    clearSession();
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: "Ana", status: "active" } as never);
  });

  it("renders the billing detail on /billings/:id and the edit form on /billings/:id/edit", async () => {
    renderAt("/billings/b1");

    expect(await screen.findByText("billing detail b1")).toBeInTheDocument();

    cleanup();
    renderAt("/billings/b1/edit");

    expect(await screen.findByText("billing edit b1")).toBeInTheDocument();
    expect(screen.queryByText("billing detail b1")).not.toBeInTheDocument();
  });

  it("renders the contact history on /contacts/:id and the form on /contacts/:id/edit", async () => {
    renderAt("/contacts/ana");

    expect(await screen.findByText("contact ledger ana")).toBeInTheDocument();

    cleanup();
    renderAt("/contacts/ana/edit");

    expect(await screen.findByText("contact form ana")).toBeInTheDocument();
    expect(screen.queryByText("contact ledger ana")).not.toBeInTheDocument();
  });

  it("renders the method list on /settings/payment-methods and the form on /new", async () => {
    renderAt("/settings/payment-methods");

    expect(await screen.findByText("payment methods list")).toBeInTheDocument();

    cleanup();
    renderAt("/settings/payment-methods/new");

    expect(await screen.findByText("payment method form")).toBeInTheDocument();
    expect(screen.queryByText("payment methods list")).not.toBeInTheDocument();
  });

  it("sends the legacy pix pages to the payment methods pages", async () => {
    const list = renderAt("/settings/pix");

    await waitFor(() => expect(list.state.location.pathname).toBe("/settings/payment-methods"));
    expect(await screen.findByText("payment methods list")).toBeInTheDocument();

    cleanup();

    const form = renderAt("/settings/pix/new");

    await waitFor(() => expect(form.state.location.pathname).toBe("/settings/payment-methods/new"));
    expect(await screen.findByText("payment method form")).toBeInTheDocument();
  });
});
