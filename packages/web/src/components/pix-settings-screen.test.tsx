import { EMPTY_BILLING_DRAFT } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft, takeDraft } from "@/lib/billing-draft";
import { PixSettingsScreen } from "./pix-settings-screen";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const method = { id: "pix-1", label: "Nubank", pixKey: "ana@example.com", pixKeyType: "email", isDefault: true, archivedAt: null };

it("hands the new Pix key back to the billing draft and returns to the form", async () => {
  saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p1"] }, "/charges/new");
  vi.mocked(browserFetch)
    .mockResolvedValueOnce(Response.json({ paymentMethods: [] }))
    .mockResolvedValueOnce(Response.json(method, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ paymentMethods: [method] }));

  render(<PixSettingsScreen returnTo="/charges/new" />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Chave Pix"), "ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar chave" }));

  await vi.waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/charges/new"));
  expect(takeDraft()?.draft.pix).toBe("pix-1");
});

it("stays on the settings screen when there is no return path", async () => {
  vi.mocked(browserFetch)
    .mockResolvedValueOnce(Response.json({ paymentMethods: [] }))
    .mockResolvedValueOnce(Response.json(method, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ paymentMethods: [method] }));

  render(<PixSettingsScreen />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Chave Pix"), "ana@example.com");
  await user.click(screen.getByRole("button", { name: "Salvar chave" }));

  expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
  expect(routerMock.push).not.toHaveBeenCalled();
});
