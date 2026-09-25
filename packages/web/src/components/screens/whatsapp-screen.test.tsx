import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanTier, WhatsappInstanceState, WhatsappSender } from "@receivy/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { WhatsappScreen } from "./whatsapp-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const fetchMock = vi.mocked(browserFetch);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const receivy = { available: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: "2026-10-12T03:00:00.000Z" } };

function arrange(settings: unknown = receivy, plan: PlanTier = PlanTier.Basic) {
  const calls: { path: string; method: string; body?: unknown }[] = [];

  fetchMock.mockImplementation(async (path, init) => {
    const method = init?.method ?? "GET";

    calls.push({ path: String(path), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (String(path).endsWith("/plan")) {
      return json({ plan, usage: { indefinite: { used: 0, limit: 30 } } });
    }

    if (String(path).endsWith("/whatsapp") && method === "GET") {
      return json(settings);
    }

    if (String(path).endsWith("/whatsapp/sender") && method === "PATCH") {
      return json({ sender: (init?.body && JSON.parse(String(init.body)).sender) ?? WhatsappSender.Receivy });
    }

    return json({});
  });

  return calls;
}

describe("WhatsappScreen", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_WHATSAPP_ENABLED", "true"));
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("locks both cards on the free plan and offers the Basic plan", async () => {
    arrange({ ...receivy, quota: null }, PlanTier.Free);
    render(<WhatsappScreen />);

    expect(await screen.findByRole("link", { name: "Assinar o Básico" })).toHaveAttribute("href", "/settings/plan");
    expect(screen.getByRole("radio", { name: /Número do Receivy/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: /Meu número/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the cycle quota and the renewal date on the Receivy card", async () => {
    arrange();
    render(<WhatsappScreen />);

    expect(await screen.findByText("37 de 150 mensagens neste ciclo")).toBeInTheDocument();
    expect(screen.getByText("Renova em 12/10/2026")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "37");
  });

  it("switches the sender back to Receivy through PATCH and keeps the pairing", async () => {
    const calls = arrange({ ...receivy, sender: WhatsappSender.Own, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z" } });

    render(<WhatsappScreen />);

    await screen.findByText(/Conectado ao/);
    fireEvent.click(screen.getByRole("radio", { name: /Número do Receivy/ }));

    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/whatsapp/sender") && call.method === "PATCH" && (call.body as { sender: string }).sender === "receivy")).toBe(true));
    expect(screen.getByText(/Conectado ao/)).toBeInTheDocument();
  });

  it("renders nothing with the kill switch off", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_ENABLED", "false");
    arrange();

    const { container } = render(<WhatsappScreen />);

    expect(container).toBeEmptyDOMElement();
  });
});
