import axe from "axe-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingCategory, BillingRecurrence, DEFAULT_FEED_FILTERS } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { LoginScreen } from "@/components/screens/login-screen";
import { CodeScreen } from "@/components/screens/code-screen";
import { FeedScreen } from "@/components/screens/feed-screen";
import { ContactsScreen } from "@/components/screens/contacts-screen";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";
import { PixSettingsScreen } from "@/components/screens/pix-settings-screen";
import { PixKeyFormScreen } from "@/components/forms/pix-key-form-screen";
import { ProfileScreen } from "@/components/screens/profile-screen";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";
import { JoinInviteScreen } from "@/components/screens/join-invite-screen";
import { OnboardingScreen } from "@/components/screens/onboarding-screen";
import { writePendingLogin } from "@/lib/auth/pending-login";

const routerMock = { replace: vi.fn(), push: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); window.sessionStorage.clear(); });

// jsdom has no layout, so color-contrast is measured from the design tokens in
// packages/common instead (tokens.test.ts); `region` is disabled because these are
// route fragments rendered without the app shell landmarks.
async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  const summary = results.violations.map(v => `${v.id}: ${v.help} -> ${v.nodes.map(n => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

const user = { id: "user", email: "fixture@example.com", name: "Ana", phone: null, avatar: null, status: "active", locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL" };
const contact = { id: "contact-1", userId: "user-1", name: "Ana Souza", nickname: "Ana", displayName: "Ana", email: "ana@example.com", phone: null, status: "pending", archivedAt: null, createdAt: "2026-09-01", lastBilledAt: null, activeCharges: 1 };
const pixMethod = { id: "pix-1", label: "Nubank", pixKey: "52998224725", pixKeyType: "cpf", isDefault: true, archivedAt: null };
const invite = { creditorFirstName: "Lucas", description: "Churrasco", amount: { amountCents: 12_000, currency: "BRL" as const }, recurrence: BillingRecurrence.Once, participantCount: 3, category: BillingCategory.Food, expired: false };

describe("accessibility of the main web screens", () => {
  it("email login form has labelled fields, reachable submit and no axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const { container } = render(<LoginScreen nextPath="/" providers={{ google: true, apple: true }} />);
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
    const { container } = render(<CodeScreen />);
    expect(await screen.findByLabelText("Código de 6 dígitos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar e Entrar/ })).toBeDisabled();
    await expectNoViolations(container);
  });

  it("onboarding form labels its single field and keeps Continuar disabled until a name exists", async () => {
    const { container } = render(<OnboardingScreen />);
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await expectNoViolations(container);
  });

  it("feed (empty) has no axe violations and names the month carousel", async () => {
    const { container } = render(<FeedScreen charges={[]} month="2026-09" viewerEmail="ana@example.com" filters={DEFAULT_FEED_FILTERS} today="2026-09-11" />);
    expect(screen.getByText("Sua timeline começa aqui")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Mês" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("contact list has a labelled search, named cards and no axe violations", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ contacts: [contact], nextCursor: null }));
    const { container } = render(<ContactsScreen />);
    expect(await screen.findByRole("link", { name: "Contato Ana" })).toHaveAttribute("href", "/contacts/contact-1");
    expect(screen.getByLabelText("Buscar contatos")).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("contact form labels every field and has no axe violations", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json(contact));
    const { container } = render(<ContactFormScreen />);
    for (const label of ["Nome completo", "Apelido", "E-mail (opcional)"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar contato" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("Pix key list names its per-key actions and has no axe violations", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ paymentMethods: [pixMethod] }));
    const { container } = render(<PixSettingsScreen />);
    expect(await screen.findByRole("button", { name: "Copiar chave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cadastrar nova chave" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("Pix key form exposes the type radiogroup and has no axe violations", async () => {
    vi.mocked(browserFetch).mockImplementation(async path =>
      String(path) === "/api/auth/me" ? Response.json({ user: { email: "ana@example.com" } }) : Response.json({ paymentMethods: [] }),
    );
    const { container } = render(<PixKeyFormScreen />);
    expect(await screen.findByRole("radiogroup", { name: "Tipo de chave" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "CPF" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Salvar chave Pix" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("profile exposes the destructive action and has no axe violations", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (String(path) === "/api/auth/me") return Response.json({ user });
      throw new Error(`unexpected ${String(path)}`);
    });
    const { container } = render(<ProfileScreen />);
    expect(await screen.findByRole("button", { name: "Excluir conta" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("billing creation form is operable by keyboard and has no axe violations", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path.startsWith("/api/contacts")) return Response.json({ contacts: [contact], nextCursor: null });
      if (path.includes("payment-methods")) return Response.json({ paymentMethods: [pixMethod] });
      if (path.includes("auth/me")) return Response.json({ user: { timezone: "America/Sao_Paulo" } });
      throw new Error(`unexpected ${path}`);
    });
    const { container } = render(<BillingFormScreen billing={null} onSaved={vi.fn()} />);
    const keyboard = userEvent.setup();

    // Contacts enter through the agenda dialog, all by keyboard.
    const add = await screen.findByRole("button", { name: "Adicionar" });
    add.focus();
    await keyboard.keyboard(" ");
    const panel = await screen.findByRole("dialog", { name: "Contatos" });
    expect(within(panel).getByRole("button", { name: "+ Novo contato" })).toBeInTheDocument();
    const option = await within(panel).findByRole("checkbox", { name: "Ana" });
    option.focus();
    await keyboard.keyboard(" ");
    expect(option).toBeChecked();
    await keyboard.click(within(panel).getByRole("button", { name: "Concluir" }));
    expect(screen.getByRole("button", { name: /Ana/ })).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByRole("radiogroup", { name: "Modalidade" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Divisão" })).toBeInTheDocument();
    expect(screen.getByLabelText("Valor total")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toBeInTheDocument();
    expect(screen.getByLabelText("Vencimento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeInTheDocument();
    await expectNoViolations(container);

    // A conta a pagar swaps the participants and the wallet for a payee and an inline key.
    await keyboard.click(screen.getByRole("radio", { name: "Vou pagar" }));
    expect(screen.getByRole("radiogroup", { name: "Direção" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Tipo de chave" })).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail Pix")).toBeInTheDocument();
    expect(screen.getByLabelText("Apelido da chave (opcional)")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Divisão" })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("invite page labels its action and has no axe violations", async () => {
    const { container } = render(<JoinInviteScreen token="tok-1" view={invite} authenticated />);
    expect(screen.getByRole("button", { name: "Participar" })).toBeEnabled();
    await expectNoViolations(container);
  });
});
