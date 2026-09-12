import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "@/components/app/app-shell";

afterEach(() => {
  cleanup();
});

describe("AppShell", () => {
  it("exposes exactly the three approved navigation destinations", () => {
    render(
      <AppShell>
        <p>Conteúdo</p>
      </AppShell>,
    );

    for (const label of ["Feed", "Contas", "Perfil"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    expect(screen.queryByText("Contatos")).not.toBeInTheDocument();
    expect(screen.queryByText("Ajustes")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nova conta" })).not.toBeInTheDocument();
  });

  it("links the bell to the profile and shows a dot only when badged", () => {
    const { rerender } = render(
      <AppShell>
        <p>Conteúdo</p>
      </AppShell>,
    );

    const bells = screen.getAllByRole("link", { name: "Notificações" });

    for (const bell of bells) {
      expect(bell).toHaveAttribute("href", "/settings");
    }

    expect(screen.queryAllByTestId("header-bell-dot").length).toBe(0);

    rerender(
      <AppShell notificationsBadge>
        <p>Conteúdo</p>
      </AppShell>,
    );

    expect(screen.getAllByTestId("header-bell-dot").length).toBeGreaterThan(0);
  });
});
