import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleScreen } from "./people-screen";
import { browserFetch } from "@/lib/auth/browser-fetch";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("PeopleScreen", () => {
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
});
