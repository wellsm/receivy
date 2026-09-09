import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleScreen } from "./people-screen";
import PeoplePage from "@/app/(protected)/people/page";
import NewPersonPage from "@/app/(protected)/people/new/page";
import EditPersonPage from "@/app/(protected)/people/[id]/edit/page";
import PersonPage from "@/app/(protected)/people/[id]/page";
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
  name: "Ana Souza",
  nickname: "Aninha",
  displayName: "Aninha",
  email: "ana@example.com",
  phone: "+5511987654321",
  archivedAt: null,
  createdAt: "2026-09-01",
  hasAccount: true,
  lastBilledAt: null,
  activeCharges: 2,
};

const bruno = { ...ana, id: "bruno", name: "Bruno Lima", nickname: null, displayName: "Bruno Lima", phone: null, email: "bruno@example.com", activeCharges: 0 };

describe("PeopleScreen", () => {
  it("lists contacts by display name with the pending badge and the phone subtitle", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ people: [ana, bruno], nextCursor: null }));
    render(<PeopleScreen />);

    const card = await screen.findByRole("link", { name: "Contato Aninha" });

    expect(card).toHaveAttribute("href", "/people/ana");
    expect(card).toHaveTextContent("Aninha");
    expect(card).toHaveTextContent("2 ativas");
    expect(card).toHaveTextContent("(11) 98765-4321");
    expect(card).toHaveTextContent("AS");

    const other = screen.getByRole("link", { name: "Contato Bruno Lima" });

    expect(other).toHaveTextContent("Sem pendências");
    expect(other).toHaveTextContent("bruno@example.com");
    expect(screen.getByText("2 contatos")).toBeInTheDocument();
    expect(screen.getByText("CONTATOS")).toBeInTheDocument();
  });

  it("searches the server agenda after the typing settles", async () => {
    vi.mocked(browserFetch).mockImplementation(async path =>
      Response.json({ people: String(path).includes("search=Ana") ? [ana] : [], nextCursor: null }),
    );
    render(<PeopleScreen />);

    await userEvent.setup().type(screen.getByLabelText("Buscar contatos"), "Ana");

    expect(await screen.findByRole("link", { name: "Contato Aninha" })).toBeInTheDocument();
  });

  it("shows the empty state and no inline form", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ people: [], nextCursor: null }));
    render(<PeopleScreen />);

    expect(await screen.findByText("Nenhum contato ainda")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome completo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar contato" })).not.toBeInTheDocument();
  });

  it("pages through the agenda", async () => {
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(Response.json({ people: [ana], nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(Response.json({ people: [bruno], nextCursor: null }));
    render(<PeopleScreen />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByRole("link", { name: "Contato Bruno Lima" })).toBeInTheDocument();
    expect(browserFetch).toHaveBeenLastCalledWith(expect.stringContaining("cursor=cursor-2"));
  });

  it("sends the new contact button to the dedicated form, carrying the return path", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ people: [], nextCursor: null }));
    render(<PeopleScreen returnTo="/charges/new" />);

    await screen.findByText("Nenhum contato ainda");

    for (const link of screen.getAllByRole("link", { name: "Novo contato" })) {
      expect(link).toHaveAttribute("href", "/people/new?returnTo=%2Fcharges%2Fnew");
    }
  });

  it("links to the plain form when the list was opened on its own", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ people: [], nextCursor: null }));
    render(<PeopleScreen />);

    await screen.findByText("Nenhum contato ainda");

    expect(screen.getAllByRole("link", { name: "Novo contato" })[0]).toHaveAttribute("href", "/people/new");
  });
});

describe("contextual back links", () => {
  function emptyApi() {
    vi.mocked(browserFetch).mockImplementation(async path =>
      String(path).includes("payment-methods")
        ? Response.json({ paymentMethods: [] })
        : String(path) === "/api/auth/me"
          ? Response.json({ user: { email: "conta@example.com" } })
          : Response.json({ people: [], nextCursor: null, charges: [] }),
    );
  }

  it("names the screen the contacts page came from", async () => {
    emptyApi();
    render(await PeoplePage({ searchParams: Promise.resolve({ returnTo: "/charges/new" }) }));

    expect(screen.getByRole("link", { name: "← Nova cobrança" })).toHaveAttribute("href", "/charges/new");
  });

  it("falls back to the profile when the contacts page was opened on its own", async () => {
    emptyApi();
    render(await PeoplePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Perfil" })).toHaveAttribute("href", "/settings");
  });

  it("sends the contact history back to the contact list", async () => {
    emptyApi();
    render(await PersonPage({ params: Promise.resolve({ id: "ana" }) }));

    expect(screen.getByRole("link", { name: "← Contatos" })).toHaveAttribute("href", "/people");
  });

  it("sends the contact form back to the list, or to the screen that asked for it", async () => {
    emptyApi();
    render(await NewPersonPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Contatos" })).toHaveAttribute("href", "/people");

    cleanup();
    render(await NewPersonPage({ searchParams: Promise.resolve({ returnTo: "/charges/new" }) }));

    expect(screen.getByRole("link", { name: "← Nova cobrança" })).toHaveAttribute("href", "/charges/new");
  });

  it("sends the contact edit form back to the list", async () => {
    emptyApi();
    render(await EditPersonPage({ params: Promise.resolve({ id: "ana" }), searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Contatos" })).toHaveAttribute("href", "/people");
  });

  it("names the screen the Pix keys page came from", async () => {
    emptyApi();
    render(await PixSettingsPage({ searchParams: Promise.resolve({ returnTo: "/charges/new", required: "1" }) }));

    expect(screen.getByRole("link", { name: "← Nova cobrança" })).toHaveAttribute("href", "/charges/new");
    expect(screen.getByText("Você precisa de uma chave Pix para criar cobranças.")).toBeInTheDocument();
  });

  it("falls back to the profile on the Pix keys page", async () => {
    emptyApi();
    render(await PixSettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Perfil" })).toHaveAttribute("href", "/settings");
  });

  it("sends the Pix key form back to the key list", async () => {
    emptyApi();
    render(await NewPixKeyPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "← Chaves Pix" })).toHaveAttribute("href", "/settings/pix");
  });
});
