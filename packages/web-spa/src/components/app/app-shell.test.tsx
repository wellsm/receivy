import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "@/components/app/app-shell";
import { renderWithRouter } from "@/test/render";

afterEach(() => {
  cleanup();
});

describe("AppShell", () => {
  it("exposes exactly the three approved navigation destinations", async () => {
    renderWithRouter(
      <AppShell>
        <p>Conteúdo</p>
      </AppShell>,
    );

    for (const label of ["Feed", "Contas", "Perfil"]) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }

    expect(screen.queryByText("Contatos")).not.toBeInTheDocument();
    expect(screen.queryByText("Ajustes")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nova conta" })).not.toBeInTheDocument();
  });

  it("links the bell to the profile and shows a dot only when badged", async () => {
    const first = renderWithRouter(
      <AppShell>
        <p>Conteúdo</p>
      </AppShell>,
    );

    const bells = await screen.findAllByRole("link", { name: "Notificações" });

    for (const bell of bells) {
      expect(bell).toHaveAttribute("href", "/settings");
    }

    expect(screen.queryAllByTestId("header-bell-dot").length).toBe(0);
    first.unmount();

    renderWithRouter(
      <AppShell notificationsBadge>
        <p>Conteúdo</p>
      </AppShell>,
    );

    expect((await screen.findAllByTestId("header-bell-dot")).length).toBeGreaterThan(0);
  });

  it("has no bottom navigation: Feed and Contas draw their own header, Perfil goes back to the Feed", async () => {
    const first = renderWithRouter(
      <AppShell activePath="/feed">
        <p>Conteúdo</p>
      </AppShell>,
    );

    expect(await screen.findAllByRole("navigation")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Voltar/ })).not.toBeInTheDocument();
    first.unmount();

    renderWithRouter(
      <AppShell activePath="/settings">
        <p>Conteúdo</p>
      </AppShell>,
    );

    expect(await screen.findByRole("link", { name: /Voltar/ })).toHaveAttribute("href", "/feed");
  });
});
