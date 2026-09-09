import { EMPTY_BILLING_DRAFT } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft } from "@/lib/billing-draft";
import { PixSettingsScreen } from "./pix-settings-screen";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const method = { id: "pix-1", label: "Nubank", pixKey: "ana@example.com", pixKeyType: "email", isDefault: true, archivedAt: null };

/** Serves the account e-mail, the (initially empty) key list and one creation. */
function api() {
  let created = false;

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    if (path === "/api/auth/me") {
      return Response.json({ user: { email: "conta@example.com" } });
    }

    if (init.method === "POST" || init.method === "PATCH") {
      created = true;

      return Response.json(method, { status: 201 });
    }

    return Response.json({ paymentMethods: created ? [method] : [] });
  });
}

async function typedKey(value: string) {
  const user = userEvent.setup();
  const field = screen.getByLabelText("Chave Pix");

  await vi.waitFor(() => expect(field).toHaveValue("conta@example.com"));
  await user.clear(field);
  await user.type(field, value);

  return user;
}

it("prefills the e-mail key with the account e-mail and keeps it editable", async () => {
  api();
  render(<PixSettingsScreen />);

  const field = await screen.findByLabelText("Chave Pix");

  await vi.waitFor(() => expect(field).toHaveValue("conta@example.com"));

  await userEvent.setup().type(field, ".br");

  expect(field).toHaveValue("conta@example.com.br");
});

it("announces why the Pix key is required when the billing form asked for it", async () => {
  api();
  render(<PixSettingsScreen required />);

  expect(await screen.findByText("Você precisa de uma chave Pix para criar cobranças.")).toBeInTheDocument();
});

it("hides the required notice on a plain visit", async () => {
  api();
  render(<PixSettingsScreen />);

  await screen.findByLabelText("Chave Pix");

  expect(screen.queryByText("Você precisa de uma chave Pix para criar cobranças.")).not.toBeInTheDocument();
});

it("hands the new Pix key back to the billing draft and returns to the form", async () => {
  saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p1"] }, "/charges/new");
  api();

  render(<PixSettingsScreen returnTo="/charges/new" />);

  const user = await typedKey("ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar chave" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/charges/new"));
  expect(takeDraft()?.draft.pix).toBe("pix-1");
});

it("stays on the settings screen when there is no return path", async () => {
  api();

  render(<PixSettingsScreen />);

  const user = await typedKey("ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar chave" }));

  expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
  expect(routerMock.push).not.toHaveBeenCalled();
});
