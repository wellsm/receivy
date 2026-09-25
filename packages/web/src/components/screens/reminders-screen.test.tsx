import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SYSTEM_REMINDER_CONFIG } from "@receivy/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { RemindersScreen } from "./reminders-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const fetchMock = vi.mocked(browserFetch);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

// Every existing test assumes the channel chips exist; the kill-switch tests flip the flag off themselves.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_WHATSAPP_ENABLED", "true");
});

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllEnvs(); });

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
  it("puts the default rule on the ruler and lists it with its channels", async () => {
    arrange();
    render(<RemindersScreen />);

    expect(await screen.findByRole("slider", { name: "Lembrete 1" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("O AVISO")).toBeTruthy();
    expect(screen.getByText("email · push")).toBeTruthy();
    expect(screen.getByText(/Sempre às 6h no fuso da conta/)).toBeTruthy();
  });

  it("creates a rule from a free dot and moves a pin with the arrow keys", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Criar lembrete 3 dias antes" }));

    expect(screen.getByText("OS 2 AVISOS")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Lembrete 2" })).toHaveAttribute("aria-valuenow", "-3");

    const pin = screen.getByRole("slider", { name: "Lembrete 1" });

    pin.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");

    expect(screen.getByRole("slider", { name: "Lembrete 1" })).toHaveAttribute("aria-valuenow", "2");
  });

  it("pauses a rule from its row", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("switch", { name: "Lembrete 1 ativo" }));

    expect(screen.getByText("pausado")).toBeTruthy();
  });

  it("locks the WhatsApp options behind the plan on the free plan", async () => {
    arrange();
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Editar lembrete 1" }));

    expect(screen.getByRole("radio", { name: "whatsapp no lembrete 1" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: "email no lembrete 1" })).toHaveProperty("disabled", false);
    expect(screen.getAllByText("Plano Básico").length).toBeGreaterThan(0);
  });

  it("saves the picked channels and clears the config back to the default", async () => {
    // WhatsApp must be both plan-allowed and transport-available to exercise the option itself.
    arrange({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Editar lembrete 1" }));
    await userEvent.click(screen.getByRole("radio", { name: "whatsapp no lembrete 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");

      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1]!.body)).reminders[0].channels).toEqual({ email: false, whatsapp: true });
    });

    await userEvent.click(screen.getByRole("button", { name: "Voltar ao padrão" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
  });

  it("refuses saving with zero rules inline", async () => {
    arrange(undefined, "basic");
    render(<RemindersScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Editar lembrete 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Remover lembrete 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Lembretes inválidos");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("hides the channel chips and the manual section, and saves whatsapp rules back as e-mail, when the kill switch is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_ENABLED", "false");
    arrange(
      {
        config: {
          reminders: [{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: true } }],
          manual: { email: true, whatsapp: true },
        },
        inherited: true,
        whatsappAvailable: true,
      },
      "basic",
    );
    render(<RemindersScreen />);

    expect(await screen.findByText("email · push")).toBeTruthy();
    expect(screen.queryByText("Lembrete manual")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Editar lembrete 1" }));

    expect(screen.queryByRole("radiogroup", { name: "Canais do lembrete 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "whatsapp no lembrete 1" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");

      expect(put).toBeTruthy();

      const body = JSON.parse(String(put![1]!.body));

      expect(body.reminders[0].channels).toEqual({ email: true, whatsapp: false });
      expect(body.manual).toEqual({ email: true, whatsapp: false });
    });
  });
});
