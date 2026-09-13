import { EMPTY_BILLING_DRAFT, UserStatus, type Contact } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft } from "@/lib/billing-draft";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const ana: Contact = {
  id: "c1",
  userId: "user-ana",
  name: "Ana Souza",
  nickname: "Aninha",
  displayName: "Aninha",
  email: "ana@example.com",
  phone: "+5511987654321",
  status: UserStatus.Pending,
  archivedAt: null,
  createdAt: "2026-01-01",
  lastBilledAt: null,
  activeCharges: 0,
};

type Sent = { path: string; init: RequestInit };

function api(contact = ana) {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    if (init.method === "POST" || init.method === "PATCH") {
      return Response.json({ ...contact, id: "saved", userId: "user-saved" }, { status: 201 });
    }

    return Response.json(contact);
  });

  return sent;
}

it("creates a contact with a nickname and an e-mail", async () => {
  const sent = api();
  render(<ContactFormScreen />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.type(screen.getByLabelText("Apelido"), "Aninha");
  await user.type(screen.getByLabelText("E-mail (opcional)"), "Ana@Example.com");

  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/contacts"));

  const posted = sent.find(entry => entry.init.method === "POST");

  expect(posted?.path).toBe("/api/contacts");
  expect(JSON.parse(String(posted?.init.body))).toEqual({ name: "Ana Souza", nickname: "Aninha", email: "ana@example.com" });
});

it("shows the placeholders and the field hints from the design, without a phone field", async () => {
  api();
  render(<ContactFormScreen />);

  expect(screen.getByText("Adicione pessoas para dividir despesas e lembrar pagamentos sem constrangimento.")).toBeInTheDocument();
  expect(screen.getByLabelText("Apelido")).toHaveAttribute("placeholder", "Como prefere chamar");
  expect(screen.getByLabelText("E-mail (opcional)")).toHaveAttribute("placeholder", "contato@email.com");
  expect(screen.getByLabelText("E-mail (opcional)")).not.toBeRequired();
  expect(screen.getByText("Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.")).toBeInTheDocument();
  expect(screen.queryByLabelText("WhatsApp / Celular")).not.toBeInTheDocument();
});

it("saves a contact without an e-mail and leaves the key out of the body", async () => {
  const sent = api();
  render(<ContactFormScreen />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/contacts"));

  const posted = sent.find(entry => entry.init.method === "POST");

  expect(JSON.parse(String(posted?.init.body))).toEqual({ name: "Ana Souza" });
});

it("loads a contact for editing and returns to its ledger", async () => {
  const sent = api();
  render(<ContactFormScreen contactId="c1" />);

  await vi.waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Souza"));
  expect(screen.getByLabelText("E-mail (opcional)")).toHaveValue("ana@example.com");

  await userEvent.setup().click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/contacts/c1"));
  expect(sent.find(entry => entry.init.method === "PATCH")?.path).toBe("/api/contacts/c1");
});

it("locks every field but the nickname on a contact with an active account", async () => {
  api({ ...ana, status: UserStatus.Active });
  render(<ContactFormScreen contactId="c1" />);

  await vi.waitFor(() => expect(screen.getByLabelText("Nome completo")).toBeDisabled());

  expect(screen.getByLabelText("E-mail (opcional)")).toBeDisabled();
  expect(screen.getByLabelText("Apelido")).toBeEnabled();
  expect(screen.getByText("Contato vinculado a uma conta: só o apelido pode mudar.")).toBeInTheDocument();
});

it("hands the new contact's account back to the billing draft when it came from the form", async () => {
  saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["user-0"] }, "/billings/new");
  api();
  render(<ContactFormScreen returnTo="/billings/new" />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.type(screen.getByLabelText("E-mail (opcional)"), "ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/billings/new"));
  expect(takeDraft()?.draft.selected).toEqual(["user-0", "user-saved"]);
});

it("keeps the typed data when the server rejects the contact", async () => {
  vi.mocked(browserFetch).mockResolvedValue(Response.json({ message: "Esse e-mail já está em uso: por outro contato seu ou por uma conta ativa. Só o apelido de um contato ativo pode mudar." }, { status: 409 }));
  render(<ContactFormScreen />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.type(screen.getByLabelText("E-mail (opcional)"), "ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Esse e-mail já está em uso");
  expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Souza");
  expect(routerMock.push).not.toHaveBeenCalled();
});
