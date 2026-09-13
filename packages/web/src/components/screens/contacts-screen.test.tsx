import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactsScreen } from "@/components/screens/contacts-screen";
import ContactsPage from "@/app/(protected)/contacts/page";
import NewContactPage from "@/app/(protected)/contacts/new/page";
import EditContactPage from "@/app/(protected)/contacts/[id]/edit/page";
import ContactPage from "@/app/(protected)/contacts/[id]/page";
import PixSettingsPage from "@/app/(protected)/settings/pix/page";
import NewPixKeyPage from "@/app/(protected)/settings/pix/new/page";
import { browserFetch } from "@/lib/auth/browser-fetch";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const ana = {
  id: "ana",
  userId: "user-ana",
  name: "Ana Souza",
  nickname: "Aninha",
  displayName: "Aninha",
  email: "ana@example.com",
  phone: "+5511987654321",
  archivedAt: null,
  createdAt: "2026-09-01",
  status: "active",
  lastBilledAt: null,
  activeCharges: 2,
};

const bruno = { ...ana, id: "bruno", userId: "user-bruno", name: "Bruno Lima", nickname: null, displayName: "Bruno Lima", phone: null, email: "bruno@example.com", activeCharges: 0 };

describe("ContactsScreen", () => {
  it("lists contacts by display name with the pending badge and the phone subtitle", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ contacts: [ana, bruno], nextCursor: null }));
    render(<ContactsScreen />);

    const card = await screen.findByRole("link", { name: "Contato Aninha" });

    expect(card).toHaveAttribute("href", "/contacts/ana");
    expect(card).toHaveTextContent("Aninha");
    expect(card).toHaveTextContent("2 ativas");
    expect(card).toHaveTextContent("(11) 98765-4321");
    expect(card.querySelector("span[aria-hidden]")?.textContent).toBe("A");

    const other = screen.getByRole("link", { name: "Contato Bruno Lima" });

    expect(other).toHaveTextContent("Sem pendências");
    expect(other).toHaveTextContent("bruno@example.com");
    expect(screen.getByText("2 contatos")).toBeInTheDocument();
  });

  it("tags a contact who never signed in instead of counting charges", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ contacts: [{ ...bruno, status: "pending", activeCharges: 1 }], nextCursor: null }));
    render(<ContactsScreen />);

    const card = await screen.findByRole("link", { name: "Contato Bruno Lima" });

    expect(card).toHaveTextContent("Ainda não entrou");
    expect(card).not.toHaveTextContent("1 ativa");
  });

  it("searches the server agenda after the typing settles", async () => {
    vi.mocked(browserFetch).mockImplementation(async path =>
      Response.json({ contacts: String(path).includes("search=Ana") ? [ana] : [], nextCursor: null }),
    );
    render(<ContactsScreen />);

    await userEvent.setup().type(screen.getByLabelText("Buscar contatos"), "Ana");

    expect(await screen.findByRole("link", { name: "Contato Aninha" })).toBeInTheDocument();
  });

  it("shows the empty state and no inline form", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ contacts: [], nextCursor: null }));
    render(<ContactsScreen />);

    expect(await screen.findByText("Nenhum contato ainda")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome completo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar contato" })).not.toBeInTheDocument();
  });

  it("pages through the agenda", async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(Response.json({ contacts: [ana], nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(Response.json({ contacts: [bruno], nextCursor: null }));
    render(<ContactsScreen />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByRole("link", { name: "Contato Bruno Lima" })).toBeInTheDocument();
    expect(browserFetch).toHaveBeenLastCalledWith(expect.stringContaining("cursor=cursor-2"));
  });

  it("ignores a slow Carregar mais page once a new search replaced the list", async () => {
    const carla = { ...bruno, id: "carla", name: "Carla Dias", nickname: null, displayName: "Carla Dias" };
    let release: (page: Response) => void = () => undefined;
    const stale = new Promise<Response>(resolve => {
      release = resolve;
    });

    vi.mocked(browserFetch).mockImplementation(async path => {
      const url = String(path);

      if (url.includes("cursor=cursor-2")) {
        return stale;
      }

      if (url.includes("search=Bruno")) {
        return Response.json({ contacts: [bruno], nextCursor: null });
      }

      return Response.json({ contacts: [ana], nextCursor: "cursor-2" });
    });

    render(<ContactsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await user.type(screen.getByLabelText("Buscar contatos"), "Bruno");

    expect(await screen.findByRole("link", { name: "Contato Bruno Lima" })).toBeInTheDocument();

    await act(async () => {
      release(Response.json({ contacts: [carla], nextCursor: "cursor-3" }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.queryByRole("link", { name: "Contato Carla Dias" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Contato Aninha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("sends the new contact button to the dedicated form, carrying the return path", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ contacts: [], nextCursor: null }));
    render(<ContactsScreen returnTo="/billings/new" />);

    await screen.findByText("Nenhum contato ainda");

    for (const link of screen.getAllByRole("link", { name: "Novo contato" })) {
      expect(link).toHaveAttribute("href", "/contacts/new?returnTo=%2Fbillings%2Fnew");
    }
  });

  it("links to the plain form when the list was opened on its own", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ contacts: [], nextCursor: null }));
    render(<ContactsScreen />);

    await screen.findByText("Nenhum contato ainda");

    expect(screen.getAllByRole("link", { name: "Novo contato" })[0]).toHaveAttribute("href", "/contacts/new");
  });
});

// The header back button goes one history entry back; its href stays the declared destination,
// which is what a modified click and a pre-hydration click still use.
describe("back button destinations", () => {
  function emptyApi() {
    vi.mocked(browserFetch).mockImplementation(async path =>
      String(path).includes("payment-methods")
        ? Response.json({ paymentMethods: [] })
        : String(path) === "/api/auth/me"
          ? Response.json({ user: { email: "conta@example.com" } })
          : Response.json({ contacts: [], nextCursor: null, charges: [] }),
    );
  }

  it("names the screen the contacts page came from", async () => {
    emptyApi();
    render(await ContactsPage({ searchParams: Promise.resolve({ returnTo: "/billings/new" }) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/billings/new");
  });

  it("falls back to the profile when the contacts page was opened on its own", async () => {
    emptyApi();
    render(await ContactsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/settings");
  });

  it("sends the contact history back to the contact list", async () => {
    emptyApi();
    render(await ContactPage({ params: Promise.resolve({ id: "ana" }) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/contacts");
  });

  it("sends the contact form back to the list, or to the screen that asked for it", async () => {
    emptyApi();
    render(await NewContactPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/contacts");

    cleanup();
    render(await NewContactPage({ searchParams: Promise.resolve({ returnTo: "/billings/new" }) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/billings/new");
  });

  it("sends the contact edit form back to the contact it came from", async () => {
    emptyApi();
    render(await EditContactPage({ params: Promise.resolve({ id: "ana" }), searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/contacts/ana");
  });

  it("names the screen the Pix keys page came from", async () => {
    emptyApi();
    render(await PixSettingsPage({ searchParams: Promise.resolve({ returnTo: "/billings/new", required: "1" }) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/billings/new");
    expect(screen.getByText("Você precisa de uma chave Pix para criar cobranças.")).toBeInTheDocument();
  });

  it("falls back to the profile on the Pix keys page", async () => {
    emptyApi();
    render(await PixSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/settings");
  });

  it("sends the Pix key form back to the key list", async () => {
    emptyApi();
    render(await NewPixKeyPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Voltar" })).toHaveAttribute("href", "/settings/pix");
  });
});
