import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SYSTEM_REMINDER_CONFIG } from "@receivy/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { RemindersScreen } from "./reminders-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const fetchMock = vi.mocked(browserFetch);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function arrange(settings = { config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }, plan = "free") {
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith("/account/reminders") && (!init?.method || init.method === "GET")) { return json(settings); }
    if (path.endsWith("/plan")) { return json({ plan, usage: { indefinite: { used: 0, limit: 5 } } }); }
    if (path.endsWith("/account/reminders") && init?.method === "PUT") { return json({ ...settings, config: JSON.parse(String(init.body)), inherited: false }); }
    if (path.endsWith("/account/reminders") && init?.method === "DELETE") { return json({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }); }

    return json({}, 404);
  });
}

describe("RemindersScreen", () => {
  it("shows the default rule, the disclaimer and a locked WhatsApp chip on the free plan", async () => {
    arrange();
    render(<RemindersScreen />);

    expect(await screen.findByText("no dia")).toBeTruthy();
    expect(screen.getByText("Notificação no app vai sempre que a pessoa permitir no celular dela.")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: /WhatsApp/ })[0]).toHaveProperty("disabled", true);
    expect(screen.getAllByText("Plano Básico").length).toBeGreaterThan(0);
  });

  it("adds up to five rules and refuses the sixth", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    const add = await screen.findByRole("button", { name: "Adicionar lembrete" });

    for (let i = 0; i < 4; i++) { await userEvent.click(add); }

    expect(screen.queryByRole("button", { name: "Adicionar lembrete" })).toBeNull();
    expect(screen.getAllByRole("spinbutton", { name: /Dias/ })).toHaveLength(5);
  });

  it("saves the config with channels and clears it back to the default", async () => {
    // WhatsApp must be both plan-allowed and transport-available to exercise the toggle itself.
    arrange({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "WhatsApp no lembrete no dia" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");

      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1]!.body)).reminders[0].channels).toEqual({ email: true, whatsapp: true });
    });

    await userEvent.click(screen.getByRole("button", { name: "Voltar ao padrão" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
  });

  it("refuses an offset beyond 14 days inline", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    const days = await screen.findByRole("spinbutton", { name: "Dias do lembrete 1" });

    await userEvent.clear(days);
    await userEvent.type(days, "20");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Lembretes inválidos");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});
