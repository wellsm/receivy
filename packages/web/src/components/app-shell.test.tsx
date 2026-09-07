import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("exposes the four approved navigation destinations", () => {
    render(
      <AppShell>
        <p>Conteúdo</p>
      </AppShell>,
    );

    for (const label of [
      "Timeline",
      "Recorrências",
      "Contatos",
      "Ajustes",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    expect(
      screen.getByRole("link", { name: "Nova cobrança" }),
    ).toHaveAttribute("href", "/charges/new");
  });
});
