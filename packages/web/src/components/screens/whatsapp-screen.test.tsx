import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlanTier, WhatsappInstanceState, WhatsappSender } from "@receivy/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "@/test/render";
import { WhatsappScreen } from "./whatsapp-screen";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const receivy = { available: true, ownAvailable: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: "2026-10-12T03:00:00.000Z" } };
const pending = { state: WhatsappInstanceState.Pending, phone: null, qr: "data:image/png;base64,QR", pairingCode: null, connectedAt: null, disconnectedAt: null };

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
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubEnv("VITE_WHATSAPP_ENABLED", "true");
    vi.stubEnv("VITE_EVOLUTION_ENABLED", "true");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("locks both cards on the free plan and offers the Basic plan", async () => {
    arrange({ ...receivy, quota: null }, PlanTier.Free);
    renderWithRouter(<WhatsappScreen />);

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
    const calls = arrange({ ...receivy, sender: WhatsappSender.Own, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null } });

    render(<WhatsappScreen />);

    await screen.findByText(/Conectado ao/);
    fireEvent.click(screen.getByRole("radio", { name: /Número do Receivy/ }));

    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/whatsapp/sender") && call.method === "PATCH" && (call.body as { sender: string }).sender === "receivy")).toBe(true));
    expect(screen.getByText(/Conectado ao/)).toBeInTheDocument();
  });

  it("keeps the radio on the card header: clicking a card body never selects it", async () => {
    const calls = arrange({ ...receivy, instance: null });

    render(<WhatsappScreen />);

    fireEvent.click(await screen.findByText(/A Meta pode bloquear o seu número/));
    expect(screen.getByRole("radio", { name: /Meu número/ })).not.toContainElement(screen.getByText(/A Meta pode bloquear o seu número/));
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("does not PATCH when the Receivy card body is clicked while the own number is selected", async () => {
    const calls = arrange({ ...receivy, sender: WhatsappSender.Own, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null } });

    render(<WhatsappScreen />);

    fireEvent.click(await screen.findByText("37 de 150 mensagens neste ciclo"));
    await screen.findByText(/Conectado ao/);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("renders nothing with both flags off", () => {
    vi.stubEnv("VITE_WHATSAPP_ENABLED", "false");
    vi.stubEnv("VITE_EVOLUTION_ENABLED", "false");
    arrange();

    const { container } = render(<WhatsappScreen />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the Receivy quota card, with no radios and no own-number option, when only that flag is on", async () => {
    vi.stubEnv("VITE_EVOLUTION_ENABLED", "false");
    arrange();

    render(<WhatsappScreen />);

    expect(await screen.findByText("37 de 150 mensagens neste ciclo")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText("Meu número")).not.toBeInTheDocument();
  });

  it("shows only the own-number card, with no radios and no quota line, when only the Evolution flag is on", async () => {
    vi.stubEnv("VITE_WHATSAPP_ENABLED", "false");
    arrange({ ...receivy, instance: null });

    render(<WhatsappScreen />);

    expect(await screen.findByRole("checkbox", { name: /Entendo que este canal não é oficial/ })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/mensagens neste ciclo/)).not.toBeInTheDocument();
  });

  it("switches the plain own-number card back to own with Usar este número, then hides the button", async () => {
    vi.stubEnv("VITE_WHATSAPP_ENABLED", "false");

    const calls = arrange({ ...receivy, available: false, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null } });

    render(<WhatsappScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Usar este número" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Usar este número" })).not.toBeInTheDocument());
    expect(calls.some((call) => call.path.endsWith("/whatsapp/sender") && call.method === "PATCH" && (call.body as { sender: string }).sender === "own")).toBe(true);
  });

  it("disables the own-number radio and tags it Em breve when the capability is off, with both flags on", async () => {
    arrange({ ...receivy, ownAvailable: false });

    render(<WhatsappScreen />);

    expect(await screen.findByText("37 de 150 mensagens neste ciclo")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Meu número/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Em breve")).toBeInTheDocument();
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
    // The API sets the sender to own on POST /whatsapp/instance (create), before the pairing even opens.
    expect(screen.getByRole("radio", { name: /Meu número/ })).toHaveAttribute("aria-checked", "true");
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(polls).toBe(2);
    expect(screen.getByText(/Conectado ao/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(polls).toBe(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(polls).toBe(2);
  });

  it("asks for a fresh code with refresh=true", async () => {
    const calls = arrange({ ...receivy, instance: { ...pending, phone: "5511988887777", pairingCode: "ABCD-1234" } });

    render(<WhatsappScreen />);

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gerar novo" }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/whatsapp/instance?refresh=true"))).toBe(true));
  });

  it("offers code pairing with a phone, posting it in the connect body", async () => {
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
        return json({ ...pending, qr: null, pairingCode: "ABCD-1234" }, 201);
      }

      return json({ instance: pending });
    });
    render(<WhatsappScreen />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /Entendo que este canal não é oficial/ }));
    fireEvent.click(screen.getByRole("button", { name: "Prefiro conectar com código" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Telefone" }), { target: { value: "(11) 98888-7777" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ riskAccepted: true, phone: "(11) 98888-7777" });
  });

  it("cancels the pending pairing", async () => {
    const calls = arrange({ ...receivy, instance: pending });

    render(<WhatsappScreen />);

    await screen.findByRole("img", { name: "QR code para conectar" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(await screen.findByRole("checkbox", { name: /Entendo que este canal não é oficial/ })).toBeInTheDocument();
  });

  it("disconnects the open instance after confirming, back to the initial state", async () => {
    const calls = arrange({
      ...receivy,
      sender: WhatsappSender.Own,
      instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null },
    });

    render(<WhatsappScreen />);

    await screen.findByText(/Conectado ao/);
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent("Os lembretes voltam a sair pelo número do Receivy.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Desconectar" }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(await screen.findByRole("checkbox", { name: /Entendo que este canal não é oficial/ })).toBeInTheDocument();
    // The API sets the sender back to receivy on DELETE.
    expect(screen.getByRole("radio", { name: /Número do Receivy/ })).toHaveAttribute("aria-checked", "true");
  });

  it("ignores a poll answered after the user already cancelled the pairing", async () => {
    vi.useFakeTimers();

    const calls = arrange({ ...receivy, instance: pending });
    let resolvePoll: (() => void) | undefined;
    let pollRequests = 0;

    fetchMock.mockImplementation(async (path, init) => {
      const method = init?.method ?? "GET";

      calls.push({ path: String(path), method });

      if (String(path).endsWith("/plan")) {
        return json({ plan: PlanTier.Basic, usage: { indefinite: { used: 0, limit: 30 } } });
      }

      if (String(path).endsWith("/whatsapp") && method === "GET") {
        return json({ ...receivy, instance: pending });
      }

      if (String(path).endsWith("/whatsapp/instance") && method === "DELETE") {
        return json({});
      }

      // The polling GET /whatsapp/instance — held open until the test resolves it by hand.
      pollRequests += 1;

      return new Promise((resolve) => {
        resolvePoll = () => resolve(json({ instance: pending }));
      });
    });

    render(<WhatsappScreen />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollRequests).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    // `waitFor`/`findBy*` poll with real timers internally, which never advance under fake timers;
    // flush by hand instead.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    expect(screen.getByRole("checkbox", { name: /Entendo que este canal não é oficial/ })).toBeInTheDocument();

    // The stale poll answers only now, after the user already cancelled — it must be ignored.
    resolvePoll?.();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("checkbox", { name: /Entendo que este canal não é oficial/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "QR code para conectar" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(pollRequests).toBe(1);
  });

  it("reconnects after a drop, keeping the acceptance ticked", async () => {
    const closed = { ...pending, state: WhatsappInstanceState.Closed, qr: null, phone: "5511988887777", connectedAt: "2026-09-20T12:00:00.000Z", disconnectedAt: "2026-09-24T12:00:00.000Z" };
    const calls = arrange({ ...receivy, sender: WhatsappSender.Own, instance: closed });

    render(<WhatsappScreen />);

    expect(await screen.findByText(/Seu número desconectou em 24\/09\/2026\./)).toBeInTheDocument();
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
      instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null },
    });

    render(<WhatsappScreen />);

    const receivyRadioOpen = await screen.findByRole("radio", { name: /Número do Receivy/ });

    receivyRadioOpen.focus();
    fireEvent.keyDown(receivyRadioOpen, { key: "ArrowDown" });
    await waitFor(() => expect(withInstance.some((call) => call.method === "PATCH" && (call.body as { sender: string })?.sender === "own")).toBe(true));
  });

  it("keeps arrow-key selection locked on the Free plan, same as a click", async () => {
    const calls = arrange({ ...receivy, quota: null }, PlanTier.Free);

    renderWithRouter(<WhatsappScreen />);

    const receivyRadio = await screen.findByRole("radio", { name: /Número do Receivy/ });

    receivyRadio.focus();
    fireEvent.keyDown(receivyRadio, { key: "ArrowDown" });

    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("keeps arrow-key selection from firing a second PATCH while one is already in flight", async () => {
    const open = { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null };
    const calls = arrange({ ...receivy, sender: WhatsappSender.Own, instance: open });
    let resolvePatch: (() => void) | undefined;

    fetchMock.mockImplementation(async (path, init) => {
      const method = init?.method ?? "GET";

      calls.push({ path: String(path), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (String(path).endsWith("/plan")) {
        return json({ plan: PlanTier.Basic, usage: { indefinite: { used: 0, limit: 30 } } });
      }

      if (String(path).endsWith("/whatsapp") && method === "GET") {
        return json({ ...receivy, sender: WhatsappSender.Own, instance: open });
      }

      if (String(path).endsWith("/whatsapp/sender") && method === "PATCH") {
        return new Promise((resolve) => {
          resolvePatch = () => resolve(json({ sender: WhatsappSender.Receivy }));
        });
      }

      return json({});
    });

    render(<WhatsappScreen />);

    const ownRadio = await screen.findByRole("radio", { name: /Meu número/ });

    ownRadio.focus();
    fireEvent.keyDown(ownRadio, { key: "ArrowUp" });
    fireEvent.keyDown(ownRadio, { key: "ArrowUp" });

    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);

    resolvePatch?.();
    await waitFor(() => expect(screen.getByRole("radio", { name: /Número do Receivy/ })).toHaveAttribute("aria-checked", "true"));
  });

  it("shows the Portuguese fallback when the settings cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<WhatsappScreen />);

    expect(await screen.findByText("Não foi possível carregar o WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();
  });
});
