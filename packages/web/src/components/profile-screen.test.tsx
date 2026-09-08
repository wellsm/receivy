import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DELETED } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ProfileScreen } from "./profile-screen";

const routerMock = { replace: vi.fn(), push: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const account = {
  id: "user-1",
  email: "lucas@email.com",
  name: "Lucas Silveira",
  avatarUrl: null,
  locale: "pt-BR" as const,
  timezone: "America/Sao_Paulo",
  country: "BR" as const,
  currency: "BRL" as const,
};

function expectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

function loadAccount() {
  vi.mocked(browserFetch).mockImplementation(async (path) => {
    if (path === "/api/auth/me") return Response.json({ user: account });

    throw new Error(`unexpected ${String(path)}`);
  });
}

describe("ProfileScreen", () => {
  it("shows identity and edits the name inline", async () => {
    vi.mocked(browserFetch).mockImplementation(async (path, init) => {
      if (path === "/api/auth/me") return Response.json({ user: account });

      if (path === "/api/financial/account/profile") {
        const body = JSON.parse(String((init as RequestInit).body)) as { name: string };
        return Response.json({ user: { ...account, name: body.name } });
      }

      throw new Error(`unexpected ${String(path)}`);
    });

    render(<ProfileScreen version="1.0.0" />);
    const user = userEvent.setup();

    expect(await screen.findByText("Lucas Silveira")).toBeInTheDocument();
    expect(screen.getByText("lucas@email.com")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar nome" }));
    await user.clear(screen.getByRole("textbox", { name: "Nome" }));
    await user.type(screen.getByRole("textbox", { name: "Nome" }), "Lucas S.");
    await user.click(screen.getByRole("button", { name: "Salvar nome" }));

    expect(await screen.findByText("Lucas S.")).toBeInTheDocument();
    const call = vi.mocked(browserFetch).mock.calls.find(([path]) => path === "/api/financial/account/profile");
    expect(call).toBeDefined();
    expect((call![1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
      name: "Lucas S.",
      locale: "pt-BR",
      country: "BR",
      timezone: expectedTimezone(),
    });
  });

  it("links to contacts, pix keys, terms and privacy and shows the version", async () => {
    loadAccount();

    render(<ProfileScreen version="1.0.0" />);

    expect(await screen.findByRole("link", { name: "Gerenciar contatos" })).toHaveAttribute("href", "/people");
    expect(screen.getByRole("link", { name: "Gerenciar chaves Pix" })).toHaveAttribute("href", "/settings/pix");
    expect(screen.getByRole("link", { name: "Termos" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacidade" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByText("Receivy v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Meus Contatos")).toBeInTheDocument();
    expect(screen.getByText("Minhas Chaves Pix")).toBeInTheDocument();
  });

  it("logs out only after confirmation", async () => {
    loadAccount();
    const logout = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", logout);

    render(<ProfileScreen version="1.0.0" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sair da conta" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Deseja sair da sua conta?");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(logout).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair da conta" }));
    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(logout).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(routerMock.replace).toHaveBeenCalledWith("/login");
  });

  it("deletes the account only with the literal confirmation", async () => {
    vi.mocked(browserFetch).mockImplementation(async (path) => {
      if (path === "/api/auth/me") return Response.json({ user: account });
      if (path === "/api/financial/account") return Response.json({ deleted: true });

      throw new Error(`unexpected ${String(path)}`);
    });
    const logout = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", logout);

    render(<ProfileScreen version="1.0.0" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Excluir conta" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Excluir conta?");
    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeDisabled();

    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUI");
    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeDisabled();

    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "R");
    expect(screen.getByRole("button", { name: "Confirmar exclusão" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(browserFetch).toHaveBeenCalledWith("/api/financial/account", expect.objectContaining({ method: "DELETE" }));
    const call = vi.mocked(browserFetch).mock.calls.find(([path]) => path === "/api/financial/account");
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ confirmation: "EXCLUIR" });
    expect(logout).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(await screen.findByText(ACCOUNT_DELETED)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar ao login" })).toHaveAttribute("href", "/login");
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("keeps a logout retry when the browser session cannot be cleared", async () => {
    vi.mocked(browserFetch).mockImplementation(async (path) => {
      if (path === "/api/auth/me") return Response.json({ user: account });
      if (path === "/api/financial/account") return Response.json({ deleted: true });

      throw new Error(`unexpected ${String(path)}`);
    });
    const logout = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", logout);

    render(<ProfileScreen version="1.0.0" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Excluir conta" }));
    await user.type(screen.getByLabelText("Digite EXCLUIR para confirmar"), "EXCLUIR");
    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Conta excluída, mas não foi possível encerrar a sessão neste navegador.",
    );
    expect(screen.getByRole("button", { name: "Tentar encerrar a sessão novamente" })).toBeInTheDocument();

    logout.mockResolvedValue(new Response(null, { status: 204 }));
    await user.click(screen.getByRole("button", { name: "Tentar encerrar a sessão novamente" }));

    expect(await screen.findByText(ACCOUNT_DELETED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar encerrar a sessão novamente" })).not.toBeInTheDocument();
  });
});
