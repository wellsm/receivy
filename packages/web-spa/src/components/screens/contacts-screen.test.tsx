import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactsScreen } from "@/components/screens/contacts-screen";
import { renderWithRouter } from "@/test/render";

const API = "https://api.test";
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
  vi.stubGlobal("fetch", fetchMock);
});

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
    fetchMock.mockResolvedValue(Response.json({ contacts: [ana, bruno], nextCursor: null }));
    renderWithRouter(<ContactsScreen />);

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
    fetchMock.mockResolvedValue(Response.json({ contacts: [{ ...bruno, status: "pending", activeCharges: 1 }], nextCursor: null }));
    renderWithRouter(<ContactsScreen />);

    const card = await screen.findByRole("link", { name: "Contato Bruno Lima" });

    expect(card).toHaveTextContent("Ainda não entrou");
    expect(card).not.toHaveTextContent("1 ativa");
  });

  it("searches the server agenda after the typing settles", async () => {
    fetchMock.mockImplementation(async path =>
      Response.json({ contacts: String(path).includes("search=Ana") ? [ana] : [], nextCursor: null }),
    );
    renderWithRouter(<ContactsScreen />);

    await userEvent.setup().type(await screen.findByLabelText("Buscar contatos"), "Ana");

    expect(await screen.findByRole("link", { name: "Contato Aninha" })).toBeInTheDocument();
  });

  it("shows the empty state and no inline form", async () => {
    fetchMock.mockResolvedValue(Response.json({ contacts: [], nextCursor: null }));
    renderWithRouter(<ContactsScreen />);

    expect(await screen.findByText("Nenhum contato ainda")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome completo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar contato" })).not.toBeInTheDocument();
  });

  it("pages through the agenda", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ contacts: [ana], nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(Response.json({ contacts: [bruno], nextCursor: null }));
    renderWithRouter(<ContactsScreen />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByRole("link", { name: "Contato Bruno Lima" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("cursor=cursor-2"), expect.anything());
  });

  it("ignores a slow Carregar mais page once a new search replaced the list", async () => {
    const carla = { ...bruno, id: "carla", name: "Carla Dias", nickname: null, displayName: "Carla Dias" };
    let release: (page: Response) => void = () => undefined;
    const stale = new Promise<Response>(resolve => {
      release = resolve;
    });

    fetchMock.mockImplementation(async path => {
      const url = String(path);

      if (url.includes("cursor=cursor-2")) {
        return stale;
      }

      if (url.includes("search=Bruno")) {
        return Response.json({ contacts: [bruno], nextCursor: null });
      }

      return Response.json({ contacts: [ana], nextCursor: "cursor-2" });
    });

    renderWithRouter(<ContactsScreen />);

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
    fetchMock.mockResolvedValue(Response.json({ contacts: [], nextCursor: null }));
    renderWithRouter(<ContactsScreen returnTo="/billings/new" />);

    await screen.findByText("Nenhum contato ainda");

    for (const link of screen.getAllByRole("link", { name: "Novo contato" })) {
      expect(link).toHaveAttribute("href", "/contacts/new?returnTo=%2Fbillings%2Fnew");
    }
  });

  it("links to the plain form when the list was opened on its own", async () => {
    fetchMock.mockResolvedValue(Response.json({ contacts: [], nextCursor: null }));
    renderWithRouter(<ContactsScreen />);

    await screen.findByText("Nenhum contato ainda");

    expect(screen.getAllByRole("link", { name: "Novo contato" })[0]).toHaveAttribute("href", "/contacts/new");
  });
});

// The header back button lives in the route files (Task 9b), which own these destinations; the
// assertions move to the route tests there and the titles stay here so none is lost.
describe("back button destinations", () => {
  it.todo("names the screen the contacts page came from");
  it.todo("falls back to the profile when the contacts page was opened on its own");
  it.todo("sends the contact history back to the contact list");
  it.todo("sends the contact form back to the list, or to the screen that asked for it");
  it.todo("sends the contact edit form back to the contact it came from");
  it.todo("names the screen the payment methods page came from");
  it.todo("falls back to the profile on the payment methods page");
  it.todo("sends the payment method form back to the method list");
});
