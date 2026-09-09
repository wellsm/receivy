import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { EmailLoginForm } from "@/components/email-login-form";
import { CodeLoginForm } from "@/components/code-login-form";
import { FeedScreen } from "@/components/feed-screen";
import { PeopleScreen } from "@/components/people-screen";
import { ProfileScreen } from "@/components/profile-screen";
import { BillingForm } from "@/components/billing-form";
import { JoinInvite } from "@/components/join-invite";
import { OnboardingForm } from "@/components/onboarding-form";
import { writePendingLogin } from "@/lib/auth/pending-login";

const routerMock = { replace: vi.fn(), push: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

// jsdom has no layout, so color-contrast is measured from the design tokens in
// packages/common instead (tokens.test.ts); `region` is disabled because these are
// route fragments rendered without the app shell landmarks.
async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  const summary = results.violations.map(v => `${v.id}: ${v.help} -> ${v.nodes.map(n => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

const summary = { receivable: { amountCents: 0, currency: "BRL" }, payable: { amountCents: 0, currency: "BRL" }, overdue: { amountCents: 0, currency: "BRL" }, pending: { amountCents: 0, currency: "BRL" }, proofsToReview: 0, receivableCount: 0, payableCount: 0 };
const user = { id: "user", email: "fixture@example.com", name: "Ana", avatarUrl: null, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL" };
const person = { id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01", hasAccount: false, lastBilledAt: null };
const invite = { creditorFirstName: "Lucas", description: "Churrasco", amount: { amountCents: 12_000, currency: "BRL" as const }, type: "once" as const, participantCount: 3, category: "food" as const, expired: false };

describe("accessibility of the main web screens", () => {
  it("email login form has labelled fields, reachable submit and no axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const { container } = render(<EmailLoginForm nextPath="/" />);
    const email = screen.getByLabelText("Seu e-mail");
    const tab = userEvent.setup();
    let reachedEmail = false, reachedSubmit = false;
    for (let i = 0; i < 12 && !(reachedEmail && reachedSubmit); i++) {
      await tab.tab();
      if (document.activeElement === email) reachedEmail = true;
      if (document.activeElement === screen.getByRole("button", { name: "Continuar com E-mail" })) reachedSubmit = true;
    }
    expect(reachedEmail).toBe(true);
    expect(reachedSubmit).toBe(true);
    await expectNoViolations(container);
  });

  it("code confirmation form has a labelled code field and no axe violations", async () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    const { container } = render(<CodeLoginForm />);
    expect(await screen.findByLabelText("Código de 6 dígitos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar e Entrar/ })).toBeDisabled();
    await expectNoViolations(container);
  });

  it("onboarding form labels its single field and keeps Continuar disabled until a name exists", async () => {
    const { container } = render(<OnboardingForm />);
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await expectNoViolations(container);
  });

  it("feed (empty) has no axe violations and its filters are keyboard buttons", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ summary, items: [], nextCursor: null }));
    const { container } = render(<FeedScreen />);
    await screen.findByText("Sua timeline começa aqui");
    for (const name of ["A receber", "A pagar"]) expect(screen.getByRole("button", { name })).toBeEnabled();
    await expectNoViolations(container);
  });

  it("people screen has labelled inputs and no axe violations", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ people: [person], nextCursor: null }));
    const { container } = render(<PeopleScreen />);
    expect((await screen.findAllByText("Ana")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getAllByRole("link").some(link => /Ana/.test(link.textContent ?? ""))).toBe(true);
    await expectNoViolations(container);
  });

  it("profile exposes the destructive action and has no axe violations", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (String(path) === "/api/auth/me") return Response.json({ user });
      throw new Error(`unexpected ${String(path)}`);
    });
    const { container } = render(<ProfileScreen version="1.0.0" />);
    expect(await screen.findByRole("button", { name: "Excluir conta" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("billing creation form is operable by keyboard and has no axe violations", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path.startsWith("/api/people")) return Response.json({ people: [person], nextCursor: null });
      if (path.includes("payment-methods")) return Response.json({ paymentMethods: [] });
      if (path.includes("auth/me")) return Response.json({ user: { timezone: "America/Sao_Paulo" } });
      throw new Error(`unexpected ${path}`);
    });
    const { container } = render(<BillingForm billing={null} onSaved={vi.fn()} onBack={vi.fn()} />);
    const contact = await screen.findByRole("button", { name: /Ana/ });
    const keyboard = userEvent.setup();
    contact.focus();
    await keyboard.keyboard(" ");
    expect(contact).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radiogroup", { name: "Modalidade" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Divisão" })).toBeInTheDocument();
    expect(screen.getByLabelText("Valor")).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toBeInTheDocument();
    expect(screen.getByLabelText("Vencimento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo contato" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar cobrança" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("invite page labels its action and has no axe violations", async () => {
    const { container } = render(<JoinInvite token="tok-1" view={invite} authenticated />);
    expect(screen.getByRole("button", { name: "Participar" })).toBeEnabled();
    await expectNoViolations(container);
  });
});
