import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED, PlanTier, UserStatus, WhatsappSender, type AuthUser } from "@receivy/common";
import { ProfileScreen } from "@/components/screens/profile-screen";
import { onSessionExpired } from "@/lib/api/client";
import { currentUser, logout } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));
vi.mock("@/lib/auth/flows", () => ({
  currentUser: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@/lib/avatar-upload", () => ({
  squareJpeg: vi.fn(async () => new Blob(["j"], { type: "image/jpeg" })),
  uploadAvatar: vi.fn(async () => ({ url: "https://bucket.test/new", version: "v3" })),
}));

const API = "https://api.test";

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => {
  cleanup();
  onSessionExpired(null);
  clearSession();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  navigate.mockReset();
});

const account: AuthUser = {
  id: "user-1",
  email: "lucas@email.com",
  name: "Lucas Silveira",
  phone: null,
  avatar: null,
  status: UserStatus.Active,
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  country: "BR",
  currency: "BRL",
};

function expectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

function loadAccount() {
  vi.mocked(currentUser).mockResolvedValue(account);
}

/** Answers every `apiFetch`/`apiJson` call by method + path; an unmapped call fails loudly. */
function stubFetch(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith(`${API}/`) ? url.slice(API.length + 1) : url;
    const method = init?.method ?? "GET";
    const key = `${method} ${path}`;
    const handler = handlers[key];

    if (!handler) {
      throw new Error(`unexpected ${key}`);
    }

    return handler(init);
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

describe("ProfileScreen", () => {
  it("shows identity and edits the name inline", async () => {
    loadAccount();

    const fetchMock = stubFetch({
      "PATCH account/profile": (init) => {
        const body = JSON.parse(String(init?.body)) as { name: string };

        return Response.json({ user: { ...account, name: body.name } });
      },
    });

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    expect(await screen.findByText("Lucas Silveira")).toBeInTheDocument();
    expect(screen.getByText("lucas@email.com")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar nome" }));
    await user.clear(screen.getByRole("textbox", { name: "Nome" }));
    await user.type(screen.getByRole("textbox", { name: "Nome" }), "Lucas S.");
    await user.click(screen.getByRole("button", { name: "Salvar nome" }));

    expect(await screen.findByText("Lucas S.")).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([input]) => String(input) === `${API}/account/profile`);

    expect(call).toBeDefined();
    expect((call![1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
      name: "Lucas S.",
      locale: "pt-BR",
      country: "BR",
      timezone: expectedTimezone(),
    });
  });

  it("changes the profile photo from Perfil", async () => {
    loadAccount();

    const { container } = renderWithRouter(<ProfileScreen />);
    const user = userEvent.setup();

    const input = await screen.findByLabelText("Trocar foto");
    const file = new File(["png"], "photo.png", { type: "image/png" });

    await user.upload(input, file);

    // alt="" gives the <img> role "presentation", not "img", so findByRole cannot see it.
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute("src", "https://bucket.test/new"));
  });

  it("links to contacts, payment methods, terms and privacy", async () => {
    loadAccount();

    renderWithRouter(<ProfileScreen />);

    expect(await screen.findByRole("link", { name: "Gerenciar contatos" })).toHaveAttribute("href", "/contacts");
    expect(screen.getByRole("link", { name: "Gerenciar meios de pagamento" })).toHaveAttribute("href", "/settings/payment-methods");
    expect(screen.getByRole("link", { name: "Gerenciar plano" })).toHaveAttribute("href", "/settings/plan");
    expect(screen.getByRole("link", { name: "Termos" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacidade" })).toHaveAttribute("href", "/privacy");
    expect(screen.queryByText(/Receivy v/)).not.toBeInTheDocument();
    expect(screen.getByText("Meus Contatos")).toBeInTheDocument();
    expect(screen.getByText("Meios de pagamento")).toBeInTheDocument();
  });

  it("lists the WhatsApp row with the sender state when the switch is on, and hides it when off", async () => {
    vi.stubEnv("VITE_WHATSAPP_ENABLED", "true");
    loadAccount();

    stubFetch({
      "GET whatsapp": () => Response.json({ available: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: "2026-10-12T03:00:00.000Z" } }),
      "GET plan": () => Response.json({ plan: PlanTier.Basic, usage: { indefinite: { used: 0, limit: 30 } } }),
    });

    renderWithRouter(<ProfileScreen />);

    expect(await screen.findByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", "/settings/whatsapp");
    expect(screen.getByText("Pelo número do Receivy · 37 de 150 neste ciclo")).toBeInTheDocument();

    vi.stubEnv("VITE_WHATSAPP_ENABLED", "false");
    renderWithRouter(<ProfileScreen />);
    expect(screen.queryAllByRole("link", { name: /WhatsApp/ })).toHaveLength(1);
  });

  it("logs out only after confirmation", async () => {
    loadAccount();
    vi.mocked(logout).mockResolvedValue(undefined);

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sair da conta" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Deseja sair da sua conta?");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair da conta" }));
    await user.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("deletes the account only with the literal confirmation", async () => {
    loadAccount();
    vi.mocked(logout).mockResolvedValue(undefined);

    const fetchMock = stubFetch({
      "DELETE account": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ confirmation: "EXCLUIR" });

        return Response.json({ deleted: true });
      },
    });

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Excluir conta" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Excluir conta?");
    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeDisabled();

    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUI");

    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeDisabled();

    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "R");

    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(fetchMock).toHaveBeenCalledWith(`${API}/account`, expect.objectContaining({ method: "DELETE" }));
    expect(await screen.findByText(ACCOUNT_DELETED)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao login" })).toHaveAttribute("href", "/login");
    expect(navigate).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it("reports an unconfirmed deletion when the account request is rejected", async () => {
    loadAccount();
    vi.mocked(logout).mockResolvedValue(undefined);

    stubFetch({
      "DELETE account": () => new Response(null, { status: 401 }),
    });

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Excluir conta" }));
    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(await screen.findByText(ACCOUNT_DELETION_UNCONFIRMED)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao login" })).toHaveAttribute("href", "/login");
    expect(navigate).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it("keeps its own unconfirmed outcome instead of the login when the session dies during the deletion", async () => {
    const expired = vi.fn();

    loadAccount();
    vi.mocked(logout).mockResolvedValue(undefined);
    storeSession({ accessToken: "a1", refreshToken: "r1", expiresIn: 900 });
    onSessionExpired(expired);

    stubFetch({
      "DELETE account": () => new Response(null, { status: 401 }),
      "POST auth/refresh": () => new Response(null, { status: 401 }),
    });

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Excluir conta" }));
    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(await screen.findByText(ACCOUNT_DELETION_UNCONFIRMED)).toBeInTheDocument();
    expect(expired).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("still goes to the login on a plain logout when the logout request fails", async () => {
    loadAccount();
    vi.mocked(logout).mockRejectedValue(new Error("network"));

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sair da conta" }));
    await user.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login", { replace: true }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  // authLogout() clears the local session in its own `finally` block, whether or not the POST
  // reaches the server, so there is no longer a "session not cleared" outcome to retry: the
  // deletion result shows regardless, and no retry affordance is rendered.
  it("shows the deletion outcome even when the session cannot be revoked server-side", async () => {
    loadAccount();
    vi.mocked(logout).mockRejectedValue(new Error("network"));

    stubFetch({
      "DELETE account": () => Response.json({ deleted: true }),
    });

    renderWithRouter(<ProfileScreen />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Excluir conta" }));
    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(await screen.findByText(ACCOUNT_DELETED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar encerrar a sessão novamente" })).not.toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  describe("appearance", () => {
    afterEach(() => {
      window.localStorage.clear();
      delete document.documentElement.dataset.theme;
    });

    it("pins the dark theme from Aparência and remembers it in the browser", async () => {
      vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
      loadAccount();

      const user = userEvent.setup();

      renderWithRouter(<ProfileScreen />);

      const group = await screen.findByRole("radiogroup", { name: "APARÊNCIA" });

      expect(screen.getByRole("radio", { name: "Sistema" })).toHaveAttribute("aria-checked", "true");

      await user.click(screen.getByRole("radio", { name: "Escuro" }));

      expect(group).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Escuro" })).toHaveAttribute("aria-checked", "true");
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(window.localStorage.getItem("receivy-theme")).toBe("dark");
    });
  });
});
