import { EMPTY_BILLING_DRAFT } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft } from "@/lib/billing-draft";
import { ContactForm } from "./contact-form";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const ana = {
  id: "p1",
  name: "Ana Souza",
  nickname: "Aninha",
  displayName: "Aninha",
  email: "ana@example.com",
  phone: "+5511987654321",
  archivedAt: null,
  createdAt: "2026-01-01",
  hasAccount: false,
  lastBilledAt: null,
  activeCharges: 0,
};

type Sent = { path: string; init: RequestInit };

function api(person = ana) {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    if (init.method === "POST" || init.method === "PATCH") {
      return Response.json({ ...person, id: "saved" }, { status: 201 });
    }

    return Response.json(person);
  });

  return sent;
}

it("creates a contact with a nickname and a masked phone", async () => {
  const sent = api();
  render(<ContactForm />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.type(screen.getByLabelText("Apelido"), "Aninha");
  await user.type(screen.getByLabelText("WhatsApp / Celular"), "11987654321");

  expect(screen.getByLabelText("WhatsApp / Celular")).toHaveValue("(11) 98765-4321");

  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/people"));

  const posted = sent.find(entry => entry.init.method === "POST");

  expect(posted?.path).toBe("/api/people");
  expect(JSON.parse(String(posted?.init.body))).toEqual({ name: "Ana Souza", nickname: "Aninha", phone: "+5511987654321" });
});

it("shows the placeholders and the field hints from the design", async () => {
  api();
  render(<ContactForm />);

  expect(screen.getByText("Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.")).toBeInTheDocument();
  expect(screen.getByLabelText("Apelido")).toHaveAttribute("placeholder", "Como prefere chamar");
  expect(screen.getByLabelText("E-mail")).toHaveAttribute("placeholder", "contato@email.com");
  expect(screen.getByText("Usado para lembretes.")).toBeInTheDocument();
  expect(screen.getByText("Usado para enviar avisos.")).toBeInTheDocument();
});

it("loads a contact for editing and returns to its ledger", async () => {
  const sent = api();
  render(<ContactForm personId="p1" />);

  expect(await screen.findByRole("heading", { name: "Editar contato" })).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Souza"));
  expect(screen.getByLabelText("WhatsApp / Celular")).toHaveValue("(11) 98765-4321");

  await userEvent.setup().click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/people/p1"));
  expect(sent.find(entry => entry.init.method === "PATCH")?.path).toBe("/api/people/p1");
});

it("locks every field but the nickname on a contact linked to an account", async () => {
  api({ ...ana, hasAccount: true });
  render(<ContactForm personId="p1" />);

  await vi.waitFor(() => expect(screen.getByLabelText("Nome completo")).toBeDisabled());

  expect(screen.getByLabelText("E-mail")).toBeDisabled();
  expect(screen.getByLabelText("WhatsApp / Celular")).toBeDisabled();
  expect(screen.getByLabelText("Apelido")).toBeEnabled();
  expect(screen.getByText("Contato vinculado a uma conta: só o apelido pode mudar.")).toBeInTheDocument();
});

it("hands the new contact back to the billing draft when it came from the form", async () => {
  saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p0"] }, "/charges/new");
  api();
  render(<ContactForm returnTo="/charges/new" />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/charges/new"));
  expect(takeDraft()?.draft.selected).toEqual(["p0", "saved"]);
});

it("keeps the typed data when the server rejects the contact", async () => {
  vi.mocked(browserFetch).mockResolvedValue(Response.json({ message: "Já existe um contato ativo com esse e-mail." }, { status: 409 }));
  render(<ContactForm />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Já existe");
  expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Souza");
  expect(routerMock.push).not.toHaveBeenCalled();
});
