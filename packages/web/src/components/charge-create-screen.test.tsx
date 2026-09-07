import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ChargeCreateScreen } from "./charge-create-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("ChargeCreateScreen", () => {
  const deferred = <T,>() => { let reject!: (reason: unknown) => void; let resolve!: (value: T) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, reject, resolve }; };
  it("freezes the submitted body and idempotency key across an uncertain retry", async () => {
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
    const retry = screen.getByRole("button", { name: "Tentar criar novamente" });
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Criar cobrança" })).toBeDisabled();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Mercado");
    await user.click(retry);
    expect(navigate).toHaveBeenCalledWith("/charges/charge-1");
    const keys = posts.map(init => (init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(posts[1]?.body).toBe(posts[0]?.body);
  });

  it("loads another people page and preserves an earlier selection", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path === "/api/people?archived=false") return Response.json({ people: [{ id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" }], nextCursor: "page-2" });
      if (path === "/api/people?archived=false&cursor=page-2") return Response.json({ people: [{ id: "person-51", name: "Zélia", email: "zelia@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" }], nextCursor: null });
      return Response.json({ paymentMethods: [] });
    });
    render(<ChargeCreateScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Ana/ }));
    await user.click(screen.getByRole("button", { name: "Carregar mais contatos" }));
    expect(await screen.findByRole("checkbox", { name: /Zélia/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Ana/ })).toBeChecked();
  });

  it("accepts comma percentages and rejects excess precision before review", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => path.startsWith("/api/people")
      ? Response.json({ people: [{ id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" }], nextCursor: null })
      : Response.json({ paymentMethods: [] }));
    render(<ChargeCreateScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Ana/ }));
    await user.type(screen.getByLabelText("Valor total"), "100,00");
    await user.click(screen.getByLabelText("Como dividir"));
    await user.selectOptions(screen.getByLabelText("Como dividir"), "percentage");
    await user.type(screen.getByLabelText("Percentual de Ana"), "33,333");
    await user.type(screen.getByLabelText("Percentual de Minha parte"), "66,667");
    await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Confira os percentuais");
    await user.clear(screen.getByLabelText("Percentual de Ana"));
    await user.type(screen.getByLabelText("Percentual de Ana"), "33,33");
    await user.clear(screen.getByLabelText("Percentual de Minha parte"));
    await user.type(screen.getByLabelText("Percentual de Minha parte"), "66,67");
    await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect(screen.getByText("Revisão exata")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar cobrança" })).toBeInTheDocument();
  });

  it("unlocks editing after a definitive server rejection", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path.startsWith("/api/people")) return Response.json({ people: [{ id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" }], nextCursor: null });
      if (path === "/api/financial/payment-methods") return Response.json({ paymentMethods: [] });
      return Response.json({ message: "Contato arquivado." }, { status: 422 });
    });
    render(<ChargeCreateScreen />); const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Ana/ }));
    await user.type(screen.getByLabelText("Valor total"), "10,00");
    await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
    await user.click(screen.getByRole("button", { name: "Criar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contato arquivado.");
    expect(screen.getByLabelText("Descrição")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Tentar criar novamente" })).not.toBeInTheDocument();
  });

  it.each([401, 429])("retains an uncertain attempt through replay status %s", async status => {
    const replay = deferred<Response>(); const posts: RequestInit[] = [];
    vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
      if (path.startsWith("/api/people")) return Response.json({ people: [{ id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" }], nextCursor: null });
      if (path === "/api/financial/payment-methods") return Response.json({ paymentMethods: [] });
      posts.push(init);
      if (posts.length === 1) return Response.json({ message: "Resposta perdida." }, { status: 503 });
      if (posts.length === 2) return replay.promise;
      return Response.json({ id: "expense-1", charges: [{ id: "charge-1" }] }, { status: 201 });
    });
    const navigate = vi.fn(); render(<ChargeCreateScreen navigate={navigate} />); const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Ana/ }));
    await user.type(screen.getByLabelText("Valor total"), "10,00");
    await user.type(screen.getByLabelText("Descrição"), "Original");
    await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
    await user.click(screen.getByRole("button", { name: "Criar cobrança" }));
    await user.click(await screen.findByRole("button", { name: "Tentar criar novamente" }));
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    await act(async () => { replay.resolve(Response.json({ message: "Reautentique ou aguarde." }, { status })); await Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Reautentique ou aguarde.");
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Tentar criar novamente" }));
    expect(navigate).toHaveBeenCalledWith("/charges/charge-1");
    expect(posts).toHaveLength(3);
    expect(posts[2]?.body).toBe(posts[0]?.body);
    expect((posts[2]?.headers as Record<string, string>)["idempotency-key"]).toBe((posts[0]?.headers as Record<string, string>)["idempotency-key"]);
  });
});
