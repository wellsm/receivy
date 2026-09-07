import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ChargeCreateScreen } from "./charge-create-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ChargeCreateScreen", () => {
  it("retains the draft and idempotency key across an uncertain retry", async () => {
    const posts: RequestInit[] = [];
    vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
      if (path === "/api/people?archived=false") return Response.json({ people: [{ id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" }], nextCursor: null });
      if (path === "/api/financial/payment-methods") return Response.json({ paymentMethods: [] });
      posts.push(init);
      if (posts.length === 1) return Response.json({ message: "A resposta da criação não chegou. Tente novamente." }, { status: 503 });
      return Response.json({ id: "expense-1", charges: [{ id: "charge-1" }] }, { status: 201 });
    });
    const navigate = vi.fn();
    render(<ChargeCreateScreen navigate={navigate} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Ana/ }));
    await user.type(screen.getByLabelText("Valor total"), "100,00");
    await user.type(screen.getByLabelText("Descrição"), "Mercado");
    await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect((await screen.findAllByText((_, element) => element?.textContent === "R$ 50,00")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Criar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A resposta da criação não chegou");
    expect(screen.getByLabelText("Descrição")).toHaveValue("Mercado");
    await user.click(screen.getByRole("button", { name: "Tentar criar novamente" }));
    expect(navigate).toHaveBeenCalledWith("/charges/charge-1");
    const keys = posts.map(init => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
});
