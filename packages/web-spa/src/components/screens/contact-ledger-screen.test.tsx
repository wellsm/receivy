import { BillingRecurrence, ChargeState, Direction, ProofState, SharingState, UserStatus, type ChargeDetail, type Contact, type ContactLedger } from "@receivy/common";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactLedgerScreen } from "@/components/screens/contact-ledger-screen";
import { takeDraft } from "@/lib/billing-draft";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();
const writeText = vi.fn(async () => {});

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));

const API = "https://api.test";

/** userEvent installs its own clipboard stub on setup, so ours has to land afterwards. */
function setup() {
  const user = userEvent.setup();

  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  return user;
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    userId: "u1",
    name: "Ana Paula Souza",
    nickname: null,
    displayName: "Ana Paula Souza",
    email: "ana@example.com",
    phone: null,
    phoneSource: null,
    whatsappConsentAt: null,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    status: UserStatus.Pending,
    lastBilledAt: null,
    activeCharges: 0,
    ...overrides,
  };
}

function charge(overrides: Partial<ChargeDetail> & { id: string }): ChargeDetail {
  return {
    description: "Jantar",
    amount: { amountCents: 6_000, currency: "BRL" },
    dueDate: "2099-01-15",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: "Ana Paula Souza",
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: "u1", name: "Ana Paula Souza", email: "ana@example.com" },
    debtorId: "u1",
    payment: null,
    paymentLink: null,
    receiptUrl: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function ledger(overrides: Partial<Contact> = {}, charges: ChargeDetail[] = []): ContactLedger {
  return {
    contactId: "c1",
    contact: contact(overrides),
    receivable: { amountCents: charges.filter((item) => item.state === "pending").reduce((sum, item) => sum + item.amount.amountCents, 0), currency: "BRL" },
    payable: { amountCents: 0, currency: "BRL" },
    charges,
    nextCursor: null,
  };
}

type Handler = (path: string, init?: RequestInit) => Response | undefined;

function mockApi(page: ContactLedger, handler: Handler = () => undefined): string[] {
  const calls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);

      return handler(path, init) ?? (path.startsWith(`${API}/contacts/c1/ledger`) ? Response.json(page) : new Response(null, { status: 404 }));
    }),
  );

  return calls;
}

describe("ContactLedgerScreen", () => {
  it("encodes the id from the URL into the API path", async () => {
    const page = ledger();
    const calls = mockApi(page, (path) => (path === `${API}/contacts/a%2Fb/ledger` ? Response.json(page) : undefined));

    renderWithRouter(<ContactLedgerScreen id="a/b" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Ana Paula Souza" })).toBeInTheDocument();
    expect(calls).toContain(`GET ${API}/contacts/a%2Fb/ledger`);
  });

  it("shows the profile card with the two-letter avatar, the full name and the formatted phone", async () => {
    mockApi(ledger({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321", email: "ana@example.com" }));

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    expect(await screen.findByRole("heading", { level: 2, name: "Aninha" })).toBeInTheDocument();
    expect(screen.getByText("Ana Paula Souza")).toBeInTheDocument();
    expect(screen.getByText("(11) 98765-4321")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("Sem cobranças ativas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });

  it("splits active charges from the history and sums the balance", async () => {
    const paid = charge({
      id: "c0",
      description: "Churrasco",
      state: ChargeState.Paid,
      paidAt: "2026-09-28T15:00:00Z",
      amount: { amountCents: 12_000, currency: "BRL" },
    });
    const waiting = charge({ id: "c2", description: "Futebol", proofState: ProofState.Pending, installmentCount: 1, installment: 1 });

    mockApi(ledger({}, [charge({ id: "c1" }), waiting, paid]));

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    expect(await screen.findByText("2 cobranças ativas")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Balanço com Ana" })).toBeInTheDocument();
    expect(screen.getByText("3 cobranças no total")).toBeInTheDocument();
    expect(screen.getByText("2 pendências")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 120,00")).toHaveLength(3);
    expect(screen.getByText("1 quitada")).toBeInTheDocument();
    expect(screen.getByText("Parcela 2 de 3 • Vencimento em 15/01/2099")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Aguardando comprovante")).toBeInTheDocument();
    expect(screen.getByText("Pago em 28/09/2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir cobrança Churrasco" })).toHaveAttribute("href", "/charges/c0");
  });

  it("copies the payment link and reminds from an active charge", async () => {
    const calls = mockApi(ledger({}, [charge({ id: "c1" })]), (path, init) => {
      if (path === `${API}/charges/c1/public-link` && init?.method === "POST") {
        return Response.json({ token: "tk", expiresAt: "2099-01-01T00:00:00Z" });
      }
      if (path === `${API}/charges/c1/reminders` && init?.method === "POST") {
        return Response.json({ queued: true });
      }

      return undefined;
    });
    const user = setup();

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    await user.click(await screen.findByRole("button", { name: "Link de Jantar" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/pay/tk"));

    expect(await screen.findByText("Link de pagamento copiado.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lembrar Jantar" }));

    await waitFor(() => expect(calls).toContain(`POST ${API}/charges/c1/reminders`));

    expect(await screen.findByText("Lembrete enviado.")).toBeInTheDocument();
  });

  it("parks a draft with the contact's account selected before opening the billing form", async () => {
    mockApi(ledger());

    const user = setup();

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    await user.click(await screen.findByRole("button", { name: "Cobrar" }));

    expect(navigate).toHaveBeenCalledWith("/billings/new");
    expect(takeDraft()).toMatchObject({ returnTo: "/billings/new", draft: { selected: ["u1"] } });
  });

  it("removes the contact only after the confirmation and hides the actions afterwards", async () => {
    let archived = false;
    const calls = mockApi(ledger(), (path, init) => {
      if (path === `${API}/contacts/c1/archive` && init?.method === "POST") {
        archived = true;

        return new Response(null, { status: 204 });
      }
      if (path.startsWith(`${API}/contacts/c1/ledger`)) {
        return Response.json(ledger(archived ? { archivedAt: "2026-10-01T00:00:00Z" } : {}));
      }

      return undefined;
    });
    const user = setup();

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    await user.click(await screen.findByRole("button", { name: "Remover" }));

    const dialog = screen.getByRole("dialog", { name: "Remover contato?" });

    expect(calls).not.toContain(`POST ${API}/contacts/c1/archive`);

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remover" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(calls).toContain(`POST ${API}/contacts/c1/archive`));

    expect(await screen.findByText("Contato removido")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cobrar" })).not.toBeInTheDocument();
  });

  it("reports a ledger failure and retries", async () => {
    let failed = false;

    mockApi(ledger(), (path) => {
      if (path.startsWith(`${API}/contacts/c1/ledger`) && !failed) {
        failed = true;

        return Response.json({ code: "unknown" }, { status: 500 });
      }

      return undefined;
    });

    const user = setup();

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Ana Paula Souza" })).toBeInTheDocument();
  });

  it("shows the contacts conflict text when the archive answers 409", async () => {
    mockApi(ledger(), (path, init) => (path === `${API}/contacts/c1/archive` && init?.method === "POST" ? Response.json({ message: "outra coisa" }, { status: 409 }) : undefined));

    const user = setup();

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    await user.click(await screen.findByRole("button", { name: "Remover" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remover" }));

    expect(await screen.findByText(/Esse e-mail já está em uso/)).toBeInTheDocument();
  });

  it("shows the archive fallback for statuses other than 400 and 409", async () => {
    mockApi(ledger(), (path, init) => (path === `${API}/contacts/c1/archive` && init?.method === "POST" ? Response.json({ message: "Limite" }, { status: 429 }) : undefined));

    const user = setup();

    renderWithRouter(<ContactLedgerScreen id="c1" />);

    await user.click(await screen.findByRole("button", { name: "Remover" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remover" }));

    expect(await screen.findByText("Não foi possível remover o contato.")).toBeInTheDocument();
  });

  it("shows the Portuguese fallback when the ledger cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderWithRouter(<ContactLedgerScreen id="c1" />);

    expect(await screen.findByText("Não foi possível carregar o histórico.")).toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();
  });
});
