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
const pending = { state: WhatsappInstanceState.Pending, phone: null, qr: "data:image/png;base64,QR", pairingCode: null, connectedAt: null };

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
    vi.useRealTimers();
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

  it("keeps Conectar disabled until the risk checkbox is ticked, then posts the acceptance and shows the QR", async () => {
    const calls = arrange({ ...receivy, instance: null });

    fetchMock.mockImplementation(async (path, init) => {
      const method = init?.method ?? "GET";

      calls.push({ path: String(path), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (String(path).endsWith("/plan")) {
        return json({ plan: PlanTier.Basic, usage: { indefinite: { used: 0, limit: 30 } } });
      }

      if (String(path).endsWith("/whatsapp") && method === "GET") {
        return json({ ...receivy, instance: null });
      }

      if (String(path).endsWith("/whatsapp/instance") && method === "POST") {
        return json(pending, 201);
      }

      return json({ instance: pending });
    });
    render(<WhatsappScreen />);

    const button = await screen.findByRole("button", { name: "Conectar" });

    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Entendo que este canal não é oficial/ }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    // Review Focus 3: a second click while the POST is in flight must not fire a second request.
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(await screen.findByRole("img", { name: "QR code para conectar" })).toHaveAttribute("src", pending.qr);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ riskAccepted: true });
    expect(screen.getByText(/Dispositivos conectados/)).toBeInTheDocument();
  });

  it("polls the instance every 5 s while pending, stops when it opens, and stops on unmount", async () => {
    vi.useFakeTimers();

    let polls = 0;
    const calls = arrange({ ...receivy, instance: pending });

    fetchMock.mockImplementation(async (path, init) => {
      const method = init?.method ?? "GET";

      calls.push({ path: String(path), method });

      if (String(path).endsWith("/plan")) {
        return json({ plan: PlanTier.Basic, usage: { indefinite: { used: 0, limit: 30 } } });
      }

      if (String(path).endsWith("/whatsapp") && method === "GET") {
        return json({ ...receivy, instance: pending });
      }

      polls++;

      return json({ instance: polls >= 2 ? { ...pending, state: WhatsappInstanceState.Open, qr: null, phone: "5511988887777", connectedAt: "2026-09-25T12:00:00.000Z" } : pending });
    });

    const { unmount } = render(<WhatsappScreen />);

    // Two zero-length advances: the settings load needs one macrotask handoff to commit, and a second
    // for React to flush the passive effect that starts the polling interval (jsdom + fake timers).
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(polls).toBe(2);
    expect(screen.getByText(/Conectado ao/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(10000);
    expect(polls).toBe(2);

    unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(polls).toBe(2);
  });

  it("asks for a fresh code with refresh=true, and offers code pairing with a phone", async () => {
    const calls = arrange({ ...receivy, instance: { ...pending, phone: "5511988887777", pairingCode: "ABCD-1234" } });

    render(<WhatsappScreen />);

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gerar novo" }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/whatsapp/instance?refresh=true"))).toBe(true));
  });

  it("disconnects after confirming, and reconnect after a drop keeps the acceptance ticked", async () => {
    const closed = { ...pending, state: WhatsappInstanceState.Closed, qr: null, phone: "5511988887777" };
    const calls = arrange({ ...receivy, sender: WhatsappSender.Own, instance: closed });

    render(<WhatsappScreen />);

    expect(await screen.findByText(/Seu número desconectou/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(screen.getByRole("checkbox", { name: /Entendo que este canal não é oficial/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeEnabled();
  });

  it("moves the radiogroup selection with arrow keys, guarding the own-number PATCH without a pairing and sending it once an instance is open", async () => {
    const withoutInstance = arrange({ ...receivy, instance: null });
    const { unmount } = render(<WhatsappScreen />);

    const receivyRadioLocked = await screen.findByRole("radio", { name: /Número do Receivy/ });

    receivyRadioLocked.focus();
    fireEvent.keyDown(receivyRadioLocked, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("radio", { name: /Meu número/ })).toHaveFocus());
    expect(withoutInstance.some((call) => call.method === "PATCH")).toBe(false);

    unmount();
    cleanup();
    vi.resetAllMocks();

    const withInstance = arrange({
      ...receivy,
      instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z" },
    });

    render(<WhatsappScreen />);

    const receivyRadioOpen = await screen.findByRole("radio", { name: /Número do Receivy/ });

    receivyRadioOpen.focus();
    fireEvent.keyDown(receivyRadioOpen, { key: "ArrowDown" });
    await waitFor(() => expect(withInstance.some((call) => call.method === "PATCH" && (call.body as { sender: string })?.sender === "own")).toBe(true));
  });
});
