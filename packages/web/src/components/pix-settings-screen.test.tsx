import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { PixSettingsScreen } from "./pix-settings-screen";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const main = { id: "pix-1", label: "Nubank", pixKey: "52998224725", pixKeyType: "cpf", isDefault: true, archivedAt: null };
const other = { id: "pix-2", label: "", pixKey: "ana@example.com", pixKeyType: "email", isDefault: false, archivedAt: null };

function api(methods: unknown[] = [main, other]) {
  const sent: { path: string; init: RequestInit }[] = [];
  let list = methods;

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    if (init.method === "POST" && path.endsWith("/archive")) {
      list = list.filter(item => item !== other);

      return new Response(null, { status: 204 });
    }

    if (init.method === "POST") {
      return new Response(null, { status: 204 });
    }

    return Response.json({ paymentMethods: list });
  });

  return sent;
}

it("lists the active keys with the type label, the masked key and the main badge", async () => {
  api();
  render(<PixSettingsScreen />);

  expect(await screen.findByText("CHAVES ATIVAS (2)")).toBeInTheDocument();
  expect(screen.getByText("529.982.247-25")).toBeInTheDocument();
  expect(screen.getByText("CPF")).toBeInTheDocument();
  expect(screen.getByText("E-mail")).toBeInTheDocument();
  expect(screen.getByText("Principal")).toBeInTheDocument();
  expect(screen.getByText("Nubank")).toBeInTheDocument();
  expect(screen.getByText("Seus dados Pix ficam protegidos e nunca são compartilhados sem sua autorização.")).toBeInTheDocument();
});

it("copies a key to the clipboard and announces it", async () => {
  api();
  render(<PixSettingsScreen />);

  const user = userEvent.setup();
  // `userEvent.setup()` installs its own clipboard stub, so the write is spied after it.
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  await user.click((await screen.findAllByRole("button", { name: "Copiar chave" }))[0]!);

  expect(writeText).toHaveBeenCalledWith("52998224725");
  expect(await screen.findByText("Chave copiada")).toBeInTheDocument();
});

it("reports a failure instead of announcing a copy the browser cannot make", async () => {
  api();
  render(<PixSettingsScreen />);

  const user = userEvent.setup();
  // A plain-http origin exposes no clipboard at all.
  const stub = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

  try {
    await user.click((await screen.findAllByRole("button", { name: "Copiar chave" }))[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível copiar a chave.");
    expect(screen.queryByText("Chave copiada")).not.toBeInTheDocument();
  } finally {
    if (stub) {
      Object.defineProperty(navigator, "clipboard", stub);
    }
  }
});

it("closes the key menu on Escape and returns focus to its button", async () => {
  api();
  render(<PixSettingsScreen />);

  const user = userEvent.setup();
  const trigger = (await screen.findAllByRole("button", { name: /Mais ações/ }))[1]!;

  await user.click(trigger);

  expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("promotes another key to the main one", async () => {
  const sent = api();
  render(<PixSettingsScreen />);

  await userEvent.setup().click(await screen.findByRole("button", { name: "Tornar padrão" }));

  await vi.waitFor(() => expect(sent.some(entry => entry.path === "/api/financial/payment-methods/pix-2/default")).toBe(true));
});

it("asks for confirmation before deleting a key", async () => {
  const sent = api();
  render(<PixSettingsScreen />);

  const user = userEvent.setup();
  await user.click((await screen.findAllByRole("button", { name: /Mais ações/ }))[1]!);
  await user.click(screen.getByRole("button", { name: "Excluir" }));

  expect(screen.getByRole("alertdialog", { name: "Excluir chave Pix" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

  await vi.waitFor(() => expect(sent.some(entry => entry.path === "/api/financial/payment-methods/pix-2/archive")).toBe(true));
});

it("shows the empty state and no inline form", async () => {
  api([]);
  render(<PixSettingsScreen />);

  expect(await screen.findByText("Nenhuma chave ainda")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Salvar chave Pix" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("E-mail Pix")).not.toBeInTheDocument();
});

it("carries the return path and the required flag into the key form", async () => {
  api([]);
  render(<PixSettingsScreen returnTo="/charges/new" required />);

  expect(await screen.findByText("Você precisa de uma chave Pix para criar cobranças.")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Cadastrar nova chave" })[0]).toHaveAttribute(
    "href",
    "/settings/pix/new?returnTo=%2Fcharges%2Fnew&required=1",
  );
});

it("links to the plain key form on a direct visit", async () => {
  api([]);
  render(<PixSettingsScreen />);

  await screen.findByText("Nenhuma chave ainda");

  expect(screen.getAllByRole("link", { name: "Cadastrar nova chave" })[0]).toHaveAttribute("href", "/settings/pix/new");
});
