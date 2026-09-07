import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { LoginForm } from "@/components/login-form";
import { TimelineScreen } from "@/components/timeline-screen";
import { PeopleScreen } from "@/components/people-screen";
import { AccountSettings } from "@/components/account-settings";
import { ChargeCreateScreen } from "@/components/charge-create-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

// jsdom has no layout, so color-contrast is measured from the design tokens in
// packages/common instead (tokens.test.ts); `region` is disabled because these are
// route fragments rendered without the app shell landmarks.
async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  const summary = results.violations.map(v => `${v.id}: ${v.help} -> ${v.nodes.map(n => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

const summary = { receivable: { amountCents: 0, currency: "BRL" }, payable: { amountCents: 0, currency: "BRL" }, overdue: { amountCents: 0, currency: "BRL" }, pending: { amountCents: 0, currency: "BRL" }, proofsToReview: 0 };
const user = { id: "user", email: "fixture@example.com", name: "Ana", avatarUrl: null, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL" };
const person = { id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01", hasAccount: false };

describe("accessibility of the main web screens", () => {
  it("login form has labelled fields, reachable submit and no axe violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const { container } = render(<LoginForm nextPath="/" />);
    const email = screen.getByLabelText(/e-mail/i);
    const tab = userEvent.setup();
    let reachedEmail = false, reachedSubmit = false;
    for (let i = 0; i < 12 && !(reachedEmail && reachedSubmit); i++) {
      await tab.tab();
      if (document.activeElement === email) reachedEmail = true;
      if (document.activeElement === screen.getByRole("button", { name: /Receber código/ })) reachedSubmit = true;
    }
    expect(reachedEmail).toBe(true);
    expect(reachedSubmit).toBe(true);
    await expectNoViolations(container);
  });

  it("timeline (empty) has no axe violations and its filters are keyboard buttons", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ summary, items: [], nextCursor: null }));
    const { container } = render(<TimelineScreen />);
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

  it("account settings keeps destructive action disabled until confirmation and has no axe violations", async () => {
    const respond = async (path: string) => Response.json(path.endsWith("sessions") ? { sessions: [] } : { user });
    vi.stubGlobal("fetch", vi.fn(respond));
    vi.mocked(browserFetch).mockImplementation(async path => respond(String(path)));
    const { container } = render(<AccountSettings />);
    await screen.findByRole("button", { name: "Excluir conta definitivamente" });
    expect(screen.getByRole("button", { name: "Excluir conta definitivamente" })).toBeDisabled();
    await expectNoViolations(container);
  });

  it("charge creation form is operable by keyboard and has no axe violations", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => path.startsWith("/api/people")
      ? Response.json({ people: [person], nextCursor: null })
      : Response.json({ paymentMethods: [] }));
    const { container } = render(<ChargeCreateScreen />);
    const checkbox = await screen.findByRole("checkbox", { name: /Ana/ });
    const keyboard = userEvent.setup();
    checkbox.focus();
    await keyboard.keyboard(" ");
    expect(checkbox).toBeChecked();
    expect(screen.getByLabelText("Valor total")).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
