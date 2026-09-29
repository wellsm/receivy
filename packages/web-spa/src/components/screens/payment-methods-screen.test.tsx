import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaymentMethodsScreen } from "@/components/screens/payment-methods-screen";
import { renderWithRouter } from "@/test/render";

const API = "https://api.test";

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
});

const main = { id: "pix-1", label: "Nubank", provider: "pix", kind: "cpf", value: "52998224725", isDefault: true, archivedAt: null, contactId: null, createdAt: "2026-09-01T00:00:00Z" };
const other = { id: "pix-2", label: "", provider: "pix", kind: "email", value: "ana@example.com", isDefault: false, archivedAt: null, contactId: null, createdAt: "2026-09-01T00:00:00Z" };
const tag = { id: "ip-1", label: "Loja", provider: "infinitepay", kind: null, value: "minha.loja", isDefault: false, archivedAt: null, contactId: null, createdAt: "2026-09-02T00:00:00Z" };
const pagbank = { id: "pb-1", label: "Loja", provider: "pagseguro", kind: null, value: "Loja", isDefault: false, archivedAt: null, contactId: null, createdAt: "2026-09-03T00:00:00Z" };

function api(methods: unknown[] = [main, other]) {
  const sent: { path: string; init: RequestInit }[] = [];
  let list = methods;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      sent.push({ path, init });

      if (init.method === "POST" && path.endsWith("/archive")) {
        list = list.filter(item => item !== other);

        return new Response(null, { status: 204 });
      }

      if (init.method === "POST") {
        return new Response(null, { status: 204 });
      }

      return Response.json({ paymentMethods: list });
    }),
  );

  return sent;
}

it("lists the active keys with the type label, the masked key and the main badge", async () => {
  api();
  renderWithRouter(<PaymentMethodsScreen />);

  expect(await screen.findByText("MEIOS ATIVOS (2)")).toBeInTheDocument();
  expect(screen.getByText("529.982.247-25")).toBeInTheDocument();
  expect(screen.getByText("CPF")).toBeInTheDocument();
  expect(screen.getByText("E-mail")).toBeInTheDocument();
  expect(screen.getByText("Padrão")).toBeInTheDocument();
  expect(screen.getByText("Secundário")).toBeInTheDocument();
  expect(screen.queryByText("Nubank")).not.toBeInTheDocument();
  expect(screen.getByText("Seus dados de recebimento ficam protegidos e nunca são compartilhados sem sua autorização.")).toBeInTheDocument();
});

it("lists an InfinitePay method with its tag", async () => {
  api([main, tag]);
  renderWithRouter(<PaymentMethodsScreen />);

  expect(await screen.findByText("InfinitePay")).toBeInTheDocument();
  expect(screen.getByText("$minha.loja")).toBeInTheDocument();
});

it("lists a PagBank method without a copy button", async () => {
  api([main, pagbank]);
  renderWithRouter(<PaymentMethodsScreen />);

  expect(await screen.findByText("PagBank")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Copiar valor" })).toHaveLength(1);
});

it("copies a key to the clipboard and confirms inline", async () => {
  api();
  renderWithRouter(<PaymentMethodsScreen />);

  const user = userEvent.setup();
  // `userEvent.setup()` installs its own clipboard stub, so the write is spied after it.
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  await user.click((await screen.findAllByRole("button", { name: "Copiar valor" }))[0]!);

  expect(writeText).toHaveBeenCalledWith("52998224725");
  expect(await screen.findByText("Copiado")).toBeInTheDocument();
});

it("reports a failure instead of announcing a copy the browser cannot make", async () => {
  api();
  renderWithRouter(<PaymentMethodsScreen />);

  const user = userEvent.setup();
  // A plain-http origin exposes no clipboard at all.
  const stub = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

  try {
    await user.click((await screen.findAllByRole("button", { name: "Copiar valor" }))[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível copiar o valor.");
    expect(screen.queryByText("Copiado")).not.toBeInTheDocument();
  } finally {
    if (stub) {
      Object.defineProperty(navigator, "clipboard", stub);
    }
  }
});

it("closes the delete dialog on Escape and returns focus to the trash button", async () => {
  api();
  renderWithRouter(<PaymentMethodsScreen />);

  const user = userEvent.setup();
  const trigger = (await screen.findAllByRole("button", { name: "Excluir" }))[1]!;

  await user.click(trigger);

  expect(screen.getByRole("dialog", { name: "Excluir meio de pagamento?" })).toBeInTheDocument();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog", { name: "Excluir meio de pagamento?" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("promotes another key to the main one", async () => {
  const sent = api();

  renderWithRouter(<PaymentMethodsScreen />);

  await userEvent.setup().click(await screen.findByRole("button", { name: "Tornar padrão" }));

  expect(await screen.findByText("Meio principal atualizado.")).toBeInTheDocument();
  expect(sent.some(entry => entry.path === `${API}/payment-methods/pix-2/default`)).toBe(true);
});

it("asks for confirmation before deleting a key", async () => {
  const sent = api();

  renderWithRouter(<PaymentMethodsScreen />);

  const user = userEvent.setup();

  await user.click((await screen.findAllByRole("button", { name: "Excluir" }))[1]!);

  const dialog = screen.getByRole("dialog", { name: "Excluir meio de pagamento?" });

  expect(dialog).toBeInTheDocument();
  expect(dialog).toHaveTextContent("ana@example.com");
  expect(sent.some(entry => entry.path.endsWith("/archive"))).toBe(false);

  await user.click(screen.getByRole("button", { name: "Remover" }));

  expect(await screen.findByText("Meio de pagamento excluído.")).toBeInTheDocument();
  expect(sent.some(entry => entry.path === `${API}/payment-methods/pix-2/archive`)).toBe(true);
});

it("shows the empty state and no inline form", async () => {
  api([]);
  renderWithRouter(<PaymentMethodsScreen />);

  expect(await screen.findByText("Nenhum meio de pagamento")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Salvar chave Pix" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("E-mail Pix")).not.toBeInTheDocument();
});

it("carries the return path and the required flag into the key form", async () => {
  api([]);
  renderWithRouter(<PaymentMethodsScreen returnTo="/billings/new" required />);

  expect(await screen.findByText("Você precisa de um meio de pagamento para criar cobranças.")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Cadastrar novo meio" })[0]).toHaveAttribute(
    "href",
    "/settings/payment-methods/new?returnTo=%2Fbillings%2Fnew&required=1",
  );
});

it("links to the plain key form on a direct visit", async () => {
  api([]);
  renderWithRouter(<PaymentMethodsScreen />);

  await screen.findByText("Nenhum meio de pagamento");

  expect(screen.getAllByRole("link", { name: "Cadastrar novo meio" })[0]).toHaveAttribute("href", "/settings/payment-methods/new");
});

it("shows the Portuguese fallback when the list cannot be reached", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  renderWithRouter(<PaymentMethodsScreen />);

  expect(await screen.findByText("Não foi possível carregar seus meios de pagamento.")).toBeInTheDocument();
  expect(screen.queryByText(/failed to fetch/i)).toBeNull();
});
