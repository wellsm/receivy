import { EMPTY_BILLING_DRAFT, PixKeyType, UserStatus, type Contact, type PaymentMethod } from "@receivy/common";
import { cleanup, render, screen, within } from "@testing-library/react";
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

/** The contact's own keys, the way `GET /payment-methods?contactId=` answers them. */
const nubank: PaymentMethod = {
  id: "pm-1",
  type: "pix",
  label: "Nubank",
  pixKey: "ana@example.com",
  pixKeyType: PixKeyType.Email,
  isDefault: true,
  contactId: "c1",
  archivedAt: null,
  createdAt: "2026-01-01",
};
const itau: PaymentMethod = { ...nubank, id: "pm-2", label: "Itaú", pixKey: "52998224725", pixKeyType: PixKeyType.Cpf, isDefault: false, createdAt: "2026-01-02" };

type Sent = { path: string; init: RequestInit };

function api(contact = ana, keys: PaymentMethod[] = []) {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    if (path.includes("payment-methods")) {
      return init.method === "POST" ? new Response(null, { status: 204 }) : Response.json({ paymentMethods: keys });
    }

    if (init.method === "POST" || init.method === "PATCH") {
      return Response.json({ ...contact, id: "saved", userId: "user-saved" }, { status: 201 });
    }

    return Response.json(contact);
  });

  return sent;
}

function keyList() {
  return within(screen.getByRole("list", { name: "Chaves Pix do contato" }));
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

it("files the typed Pix key under the new contact", async () => {
  const sent = api();
  render(<ContactFormScreen />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");

  expect(screen.getByText("Chave Pix (opcional)")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Celular" }));
  await user.type(screen.getByLabelText("Telefone celular"), "11987654321");
  await user.type(screen.getByLabelText("Rótulo da chave"), "Nubank");

  expect(screen.getByLabelText("Telefone celular")).toHaveValue("(11) 98765-4321");
  expect(screen.getByLabelText("Rótulo da chave")).toHaveAttribute("placeholder", "Rótulo (opcional)");

  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/contacts"));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body))).toEqual({
    name: "Ana Souza",
    paymentMethod: { pixKeyType: "phone", pixKey: "+5511987654321", label: "Nubank" },
  });
});

it("leaves the label out when only the key was typed", async () => {
  const sent = api();
  render(<ContactFormScreen />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome completo"), "Ana Souza");
  await user.type(screen.getByLabelText("E-mail Pix"), "ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar contato" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/contacts"));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body))).toEqual({
    name: "Ana Souza",
    paymentMethod: { pixKeyType: "email", pixKey: "ana@example.com" },
  });
});

it("lists the contact's Pix keys on edit and promotes the one the owner picks", async () => {
  const sent = api(ana, [nubank, itau]);
  render(<ContactFormScreen contactId="c1" />);

  await vi.waitFor(() => expect(keyList().getAllByRole("listitem")).toHaveLength(2));

  expect(sent.some(entry => entry.path === "/api/financial/payment-methods?contactId=c1")).toBe(true);
  expect(keyList().getByText("Padrão")).toBeInTheDocument();
  expect(keyList().getAllByRole("button", { name: "Definir padrão" })).toHaveLength(1);

  await userEvent.setup().click(keyList().getByRole("button", { name: "Definir padrão" }));

  await vi.waitFor(() => expect(sent.filter(entry => entry.path === "/api/financial/payment-methods?contactId=c1")).toHaveLength(2));
  expect(sent.some(entry => entry.path === "/api/financial/payment-methods/pm-2/default" && entry.init.method === "POST")).toBe(true);
});

it("archives one of the contact's keys only after the owner confirms, then reloads the list", async () => {
  const sent = api(ana, [nubank, itau]);
  render(<ContactFormScreen contactId="c1" />);

  await vi.waitFor(() => expect(keyList().getAllByRole("listitem")).toHaveLength(2));

  const user = userEvent.setup();
  await user.click(keyList().getAllByRole("button", { name: "Arquivar" })[1]!);

  const dialog = screen.getByRole("dialog", { name: "Arquivar chave Pix?" });

  expect(within(dialog).getByText("529.982.247-25")).toBeInTheDocument();
  expect(sent.some(entry => entry.path.endsWith("/archive"))).toBe(false);

  await user.click(within(dialog).getByRole("button", { name: "Arquivar" }));

  await vi.waitFor(() => expect(sent.some(entry => entry.path === "/api/financial/payment-methods/pm-2/archive" && entry.init.method === "POST")).toBe(true));
  expect(sent.filter(entry => entry.path === "/api/financial/payment-methods?contactId=c1")).toHaveLength(2);
});

it("closes the dialog and says why an archive failed", async () => {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    if (path.endsWith("/archive")) {
      return Response.json({ message: "Não foi possível arquivar a chave." }, { status: 409 });
    }

    if (path.includes("payment-methods")) {
      return Response.json({ paymentMethods: [nubank, itau] });
    }

    return Response.json(ana);
  });

  render(<ContactFormScreen contactId="c1" />);

  await vi.waitFor(() => expect(keyList().getAllByRole("listitem")).toHaveLength(2));

  const user = userEvent.setup();
  await user.click(keyList().getAllByRole("button", { name: "Arquivar" })[1]!);
  await user.click(within(screen.getByRole("dialog", { name: "Arquivar chave Pix?" })).getByRole("button", { name: "Arquivar" }));

  expect(await screen.findByText("Não foi possível arquivar a chave.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(sent.filter(entry => entry.path.endsWith("/archive"))).toHaveLength(1);
  // The list is only worth reloading when something actually changed.
  expect(sent.filter(entry => entry.path === "/api/financial/payment-methods?contactId=c1")).toHaveLength(1);
});

it("keeps the key when the archive confirmation is cancelled", async () => {
  const sent = api(ana, [nubank, itau]);
  render(<ContactFormScreen contactId="c1" />);

  await vi.waitFor(() => expect(keyList().getAllByRole("listitem")).toHaveLength(2));

  const user = userEvent.setup();
  const trigger = keyList().getAllByRole("button", { name: "Arquivar" })[1]!;
  await user.click(trigger);
  await user.click(within(screen.getByRole("dialog", { name: "Arquivar chave Pix?" })).getByRole("button", { name: "Cancelar" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(sent.some(entry => entry.path.endsWith("/archive"))).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it("never asks the API for keys while the contact does not exist yet", async () => {
  const sent = api();
  render(<ContactFormScreen />);

  await screen.findByRole("button", { name: "Salvar contato" });

  expect(sent.some(entry => entry.path.includes("payment-methods"))).toBe(false);
  expect(screen.queryByRole("list", { name: "Chaves Pix do contato" })).not.toBeInTheDocument();
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
