import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BILLING_DRAFT } from "@receivy/common";
import { PeopleScreen } from "./people-screen";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft } from "@/lib/billing-draft";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
afterEach(() => { cleanup(); vi.resetAllMocks(); window.sessionStorage.clear(); });

describe("PeopleScreen", () => {
  it("searches the server agenda and displays account linkage", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => Response.json({ people: String(path).includes("search=Ana") ? [{ id: "ana", name: "Ana", hasAccount: true, email: null, phone: null, archivedAt: null, createdAt: "2026-09-01" }] : [], nextCursor: null }));
    render(<PeopleScreen />);
    await userEvent.setup().type(screen.getByLabelText("Buscar contatos"), "Ana");
    expect(await screen.findByText("Com conta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Histórico.*Ana/ })).toHaveAttribute("href", "/people/ana");
  });
  it("creates a normalized contact and reloads the persisted list", async () => {
    const person = { id: "person", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-05T00:00:00Z" };
    vi.mocked(browserFetch).mockResolvedValueOnce(Response.json({ people: [], nextCursor: null }))
      .mockResolvedValueOnce(Response.json(person, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ people: [person], nextCursor: null }));
    render(<PeopleScreen />);
    await screen.findByText("Sua agenda começa com uma pessoa");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nome"), " Ana ");
    await user.type(screen.getByLabelText(/E-mail/), "ANA@example.com");
    await user.click(screen.getByRole("button", { name: "Salvar contato" }));
    expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
    expect(browserFetch).toHaveBeenCalledWith("/api/people", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Ana", email: "ana@example.com" }) }));
  });

  it("retains entered data after a duplicate rejection", async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(Response.json({ people: [], nextCursor: null }))
      .mockResolvedValueOnce(Response.json({ message: "Já existe um contato ativo com esse e-mail." }, { status: 409 }));
    render(<PeopleScreen />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Salvar contato" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe");
    expect(screen.getByLabelText("Nome")).toHaveValue("Ana");
  });

  it("hands the new contact back to the billing draft when it came from the form", async () => {
    const person = { id: "person", name: "Ana", email: null, phone: null, archivedAt: null, createdAt: "2026-09-05T00:00:00Z" };
    saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p1"] }, "/charges/new");
    vi.mocked(browserFetch).mockResolvedValueOnce(Response.json({ people: [], nextCursor: null }))
      .mockResolvedValueOnce(Response.json(person, { status: 201 }));
    render(<PeopleScreen returnTo="/charges/new" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nome"), "Ana");
    await user.click(screen.getByRole("button", { name: "Salvar contato" }));
    await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/charges/new"));
    expect(takeDraft()?.draft.selected).toEqual(["p1", "person"]);
  });
});
