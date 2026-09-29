import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";

function open(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe.each([
  { path: "/privacy", heading: "Privacidade", title: "Privacidade | Receivy", other: "Termos de uso" },
  { path: "/terms", heading: "Termos de uso", title: "Termos de uso | Receivy", other: "Privacidade" },
])("legal page $path", ({ path, heading, title, other }) => {
  it("renders the text with the operator contact, links to its sibling and stays indexable", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubEnv("VITE_OPERATOR_CONTACT", "contato@receivy.test");

    open(path);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(/contato@receivy\.test/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: other })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar" })).toHaveAttribute("href", "/login");

    await waitFor(() => expect(document.title).toBe(title));

    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("falls back to the placeholder when no operator contact is configured", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubEnv("VITE_OPERATOR_CONTACT", "");

    open(path);

    expect(await screen.findByText(/a ser informado pelo operador/)).toBeInTheDocument();
  });
});
