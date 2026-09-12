import { EMPTY_BILLING_DRAFT } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft } from "@/lib/billing-draft";
import { PixKeyFormScreen } from "@/components/forms/pix-key-form-screen";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const saved = { id: "pix-1", label: "Nubank", pixKey: "ana@example.com", pixKeyType: "email", isDefault: false, archivedAt: null };

type Sent = { path: string; init: RequestInit };

function api(existing: unknown[] = []) {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    if (path === "/api/auth/me") {
      return Response.json({ user: { email: "conta@example.com", phone: "+5511987654321" } });
    }

    if (init.method === "POST" && path.endsWith("/default")) {
      return new Response(null, { status: 204 });
    }

    if (init.method === "POST") {
      return Response.json(saved, { status: 201 });
    }

    return Response.json({ paymentMethods: existing });
  });

  return sent;
}

async function ready() {
  await screen.findByRole("radiogroup", { name: "Tipo de chave" });

  return userEvent.setup();
}

it("prefills the e-mail key with the account e-mail and keeps it editable", async () => {
  api();
  render(<PixKeyFormScreen />);

  const field = await screen.findByLabelText("E-mail Pix");

  await vi.waitFor(() => expect(field).toHaveValue("conta@example.com"));

  await userEvent.setup().type(field, ".br");

  expect(field).toHaveValue("conta@example.com.br");
});

it("prefills the phone key with the account phone once that type is picked", async () => {
  api();
  render(<PixKeyFormScreen />);

  await vi.waitFor(() => expect(screen.getByLabelText("E-mail Pix")).toHaveValue("conta@example.com"));

  await userEvent.setup().click(screen.getByRole("radio", { name: "Celular" }));

  expect(screen.getByLabelText("Telefone celular")).toHaveValue("(11) 98765-4321");
});

it("switches the field label, placeholder and mask with the key type", async () => {
  api();
  render(<PixKeyFormScreen />);

  const user = await ready();
  await user.click(screen.getByRole("radio", { name: "CPF" }));

  const field = screen.getByLabelText("CPF do titular");

  expect(field).toHaveAttribute("placeholder", "000.000.000-00");
  expect(screen.getByRole("radio", { name: "CPF" })).toHaveAttribute("aria-checked", "true");

  await user.type(field, "12345678901");

  expect(field).toHaveValue("123.456.789-01");
});

it("pastes into the field and then offers to clear it", async () => {
  api();
  render(<PixKeyFormScreen />);

  const user = await ready();

  // `userEvent.setup()` installs its own clipboard stub, so the read is spied after it.
  vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("529.982.247-25");

  await user.click(screen.getByRole("radio", { name: "CPF" }));
  await user.click(screen.getByRole("button", { name: "Colar" }));

  await vi.waitFor(() => expect(screen.getByLabelText("CPF do titular")).toHaveValue("529.982.247-25"));

  await user.click(screen.getByRole("button", { name: "Limpar" }));

  expect(screen.getByLabelText("CPF do titular")).toHaveValue("");
});

it("saves the unmasked key without a nickname and promotes it to the main key", async () => {
  const sent = api();
  render(<PixKeyFormScreen />);

  const user = await ready();
  await user.click(screen.getByRole("radio", { name: "CPF" }));
  await user.type(screen.getByLabelText("CPF do titular"), "52998224725");

  expect(screen.getByLabelText("Definir como chave principal")).toBeChecked();
  expect(screen.queryByLabelText("Banco (opcional)")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar chave Pix" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/settings/pix"));

  const created = sent.find(entry => entry.init.method === "POST" && entry.path === "/api/financial/payment-methods");

  expect(JSON.parse(String(created?.init.body))).toEqual({ pixKeyType: "cpf", pixKey: "52998224725" });
  expect(sent.some(entry => entry.path === "/api/financial/payment-methods/pix-1/default")).toBe(true);
});

it("leaves the main key toggle off when the account already has keys", async () => {
  const sent = api([{ ...saved, id: "pix-0", isDefault: true }]);
  render(<PixKeyFormScreen />);

  const user = await ready();

  await vi.waitFor(() => expect(screen.getByLabelText("Definir como chave principal")).not.toBeChecked());

  await user.type(screen.getByLabelText("E-mail Pix"), "outra@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar chave Pix" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/settings/pix"));
  expect(sent.some(entry => entry.path.endsWith("/default"))).toBe(false);
});

it("hands the new key back to the billing draft and returns to the form", async () => {
  saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p1"] }, "/billings/new");
  api();
  render(<PixKeyFormScreen returnTo="/billings/new" required />);

  const user = await ready();

  expect(screen.getByText("Você precisa de uma chave Pix para criar cobranças.")).toBeInTheDocument();

  await vi.waitFor(() => expect(screen.getByLabelText("E-mail Pix")).toHaveValue("conta@example.com"));

  await user.click(screen.getByRole("button", { name: "Salvar chave Pix" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/billings/new"));
  expect(takeDraft()?.draft.pix).toBe("pix-1");
});
