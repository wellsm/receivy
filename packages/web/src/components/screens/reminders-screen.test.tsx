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
  it("reads the default rule as a sentence, with the disclaimer and the preview", async () => {
    arrange();
    render(<RemindersScreen />);

    expect(await screen.findByRole("button", { name: "Quando avisar no lembrete 1" })).toHaveTextContent("no dia");
    expect(screen.getByRole("button", { name: "Canais do lembrete 1" })).toHaveTextContent("e-mail");
    expect(screen.getByText("Notificação no app vai sempre que a pessoa permitir no celular dela.")).toBeTruthy();
    expect(screen.getByText(/Push sempre que houver app\./)).toBeTruthy();
  });

  it("locks the WhatsApp options behind the plan on the free plan", async () => {
    arrange();
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Canais do lembrete 1" }));

    expect(screen.getByRole("radio", { name: "WhatsApp no lembrete 1" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: "e-mail e WhatsApp no lembrete 1" })).toHaveProperty("disabled", true);
    expect(screen.getAllByText("Plano Básico").length).toBeGreaterThan(0);
  });

  it("adds up to five rules and refuses the sixth", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    const add = await screen.findByRole("button", { name: "E também avisar…" });

    for (let i = 0; i < 4; i++) { await userEvent.click(add); }

    expect(screen.queryByRole("button", { name: "E também avisar…" })).toBeNull();
    expect(screen.getByText("5 de 5")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Quando avisar no lembrete/ })).toHaveLength(5);
  });

  it("builds the offset with the segmented control and the stepper, capped at 14 days", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    const pill = await screen.findByRole("button", { name: "Quando avisar no lembrete 1" });

    await userEvent.click(pill);
    await userEvent.click(screen.getByRole("radio", { name: "antes no lembrete 1" }));

    expect(pill).toHaveTextContent("1 dia antes");

    const more = screen.getByRole("button", { name: "Mais um dia no lembrete 1" });

    for (let i = 0; i < 13; i++) { await userEvent.click(more); }

    expect(pill).toHaveTextContent("14 dias antes");
    expect(more).toHaveProperty("disabled", true);
  });

  it("saves the picked channels and clears the config back to the default", async () => {
    // WhatsApp must be both plan-allowed and transport-available to exercise the option itself.
    arrange({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Canais do lembrete 1" }));
    await userEvent.click(screen.getByRole("radio", { name: "e-mail e WhatsApp no lembrete 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");

      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1]!.body)).reminders[0].channels).toEqual({ email: true, whatsapp: true });
    });

    await userEvent.click(screen.getByRole("button", { name: "Voltar ao padrão" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
  });

  it("refuses saving with zero rules inline", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Remover lembrete 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Lembretes inválidos");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});
