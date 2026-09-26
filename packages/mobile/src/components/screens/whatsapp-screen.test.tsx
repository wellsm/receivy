import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappSettings } from "@receivy/common";
import { WhatsappScreen } from "./whatsapp-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (effect: () => void) => react.useEffect(effect, []), useRouter: () => ({ back: jest.fn(), push: jest.fn() }) };
});

const receivy: WhatsappSettings = { available: true, ownAvailable: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: "2026-10-12T03:00:00.000Z" } };
const pending = { state: WhatsappInstanceState.Pending, phone: "5511988887777", qr: null, pairingCode: "ABCD-1234", connectedAt: null, disconnectedAt: null };

function client(settings: WhatsappSettings = receivy) {
  return {
    whatsapp: jest.fn().mockResolvedValue(settings),
    whatsappInstance: jest.fn().mockResolvedValue(settings.instance),
    connectWhatsapp: jest.fn(),
    disconnectWhatsapp: jest.fn().mockResolvedValue(undefined),
    setWhatsappSender: jest.fn().mockImplementation(async (sender: WhatsappSender) => sender),
    profile: jest.fn().mockResolvedValue({ phone: "+55 11 98888-7777" }),
  };
}

const plans = (plan = PlanTier.Basic) => ({ plan: jest.fn().mockResolvedValue({ plan, usage: { indefinite: { used: 0, limit: 30 } } }) });

describe("WhatsappScreen", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "true";
    process.env.EXPO_PUBLIC_EVOLUTION_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_WHATSAPP_ENABLED;
    delete process.env.EXPO_PUBLIC_EVOLUTION_ENABLED;
  });

  it("locks both cards on the free plan and points to the site", async () => {
    await render(<WhatsappScreen client={client({ ...receivy, quota: null }) as never} plans={plans(PlanTier.Free)} />);

    expect(await screen.findByText("Lembretes por WhatsApp fazem parte do plano Básico.")).toBeTruthy();
    expect(screen.getByLabelText("Número do Receivy").props.accessibilityState?.disabled).toBe(true);
  });

  it("shows the cycle quota on the Receivy card", async () => {
    await render(<WhatsappScreen client={client() as never} plans={plans()} />);

    expect(await screen.findByText("37 de 150 mensagens neste ciclo")).toBeTruthy();
    expect(screen.getByText("Renova em 12/10/2026")).toBeTruthy();
  });

  it("switches the sender through the client and keeps the pairing", async () => {
    const api = client({ ...receivy, sender: WhatsappSender.Own, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null } });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    await screen.findByText(/Conectado ao/);
    await fireEvent.press(screen.getByLabelText("Número do Receivy"));

    await waitFor(() => expect(api.setWhatsappSender).toHaveBeenCalledWith(WhatsappSender.Receivy));
    expect(screen.getByText(/Conectado ao/)).toBeTruthy();
  });

  it("renders nothing with both flags off", async () => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "false";
    process.env.EXPO_PUBLIC_EVOLUTION_ENABLED = "false";

    const { toJSON } = await render(<WhatsappScreen client={client() as never} plans={plans()} />);

    expect(toJSON()).toBeNull();
  });

  it("shows only the Receivy quota card, with no radios and no own-number option, when only that flag is on", async () => {
    process.env.EXPO_PUBLIC_EVOLUTION_ENABLED = "false";

    await render(<WhatsappScreen client={client() as never} plans={plans()} />);

    expect(await screen.findByText("37 de 150 mensagens neste ciclo")).toBeTruthy();
    expect(screen.queryByLabelText("Enviar por")).toBeNull();
    expect(screen.queryByLabelText("Meu número")).toBeNull();
  });

  it("shows only the own-number card, with no radios and no quota line, when only the Evolution flag is on", async () => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "false";

    await render(<WhatsappScreen client={client({ ...receivy, instance: null }) as never} plans={plans()} />);

    expect(await screen.findByLabelText(/Entendo que este canal não é oficial/)).toBeTruthy();
    expect(screen.queryByLabelText("Enviar por")).toBeNull();
    expect(screen.queryByText(/mensagens neste ciclo/)).toBeNull();
  });

  it("switches the plain own-number card back to own with Usar este número, then hides the button", async () => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "false";

    const api = client({ ...receivy, available: false, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null } });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    await fireEvent.press(await screen.findByLabelText("Usar este número"));

    await waitFor(() => expect(screen.queryByLabelText("Usar este número")).toBeNull());
    expect(api.setWhatsappSender).toHaveBeenCalledWith(WhatsappSender.Own);
  });

  it("disables the own-number radio and tags it Em breve when the capability is off, with both flags on", async () => {
    await render(<WhatsappScreen client={client({ ...receivy, ownAvailable: false }) as never} plans={plans()} />);

    expect(await screen.findByText("37 de 150 mensagens neste ciclo")).toBeTruthy();
    expect(screen.getByLabelText("Meu número").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText("Em breve")).toBeTruthy();
  });

  it("prefills the phone, keeps Conectar disabled until accepted, then shows the pairing code", async () => {
    const api = client({ ...receivy, instance: null });

    api.connectWhatsapp.mockResolvedValue(pending);
    await render(<WhatsappScreen client={api as never} plans={plans()} />);

    const button = await screen.findByLabelText("Conectar");

    expect(screen.getByDisplayValue("+55 11 98888-7777")).toBeTruthy();
    expect(button.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText(/Entendo que este canal não é oficial/));
    expect(button.props.accessibilityState?.disabled).toBe(false);
    await fireEvent.press(button);

    expect(await screen.findByText("ABCD-1234")).toBeTruthy();
    expect(api.connectWhatsapp).toHaveBeenCalledWith({ riskAccepted: true, phone: "+55 11 98888-7777" });
    expect(screen.getByText(/Conectar com número de telefone/)).toBeTruthy();
  });

  it("polls every 5 s while pending and stops on open and on unmount", async () => {
    jest.useFakeTimers();

    const api = client({ ...receivy, instance: pending });

    api.whatsappInstance.mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, state: WhatsappInstanceState.Open, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null });

    const { unmount } = await render(<WhatsappScreen client={api as never} plans={plans()} />);

    await screen.findByText("ABCD-1234");
    // The first tick polls back the identical instance, so the handler skips `patch` and there is
    // nothing to flush. The second tick actually changes the state (pending → open), so that one
    // update is wrapped in `act` to keep the output clean.
    await jest.advanceTimersByTimeAsync(5000);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(api.whatsappInstance).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Conectado ao/)).toBeTruthy();

    await jest.advanceTimersByTimeAsync(10000);
    expect(api.whatsappInstance).toHaveBeenCalledTimes(2);
    unmount();
    await jest.advanceTimersByTimeAsync(10000);
    expect(api.whatsappInstance).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("refreshes the code on demand and reconnects after a drop with the acceptance kept", async () => {
    const refreshApi = client({ ...receivy, instance: pending });

    refreshApi.whatsappInstance.mockResolvedValueOnce({ ...pending, pairingCode: "NEW-CODE" });
    await render(<WhatsappScreen client={refreshApi as never} plans={plans()} />);
    await screen.findByText("ABCD-1234");
    await fireEvent.press(screen.getByLabelText("Gerar novo"));

    expect(await screen.findByText("NEW-CODE")).toBeTruthy();
    expect(refreshApi.whatsappInstance).toHaveBeenCalledWith(true);

    const closed = { ...pending, state: WhatsappInstanceState.Closed, pairingCode: null, connectedAt: "2026-09-20T12:00:00.000Z", disconnectedAt: "2026-09-24T12:00:00.000Z" };
    const api = client({ ...receivy, sender: WhatsappSender.Own, instance: closed });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    expect(await screen.findByText(/Seu número desconectou em 24\/09\/2026\./)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Reconectar"));

    await waitFor(() => expect(api.disconnectWhatsapp).toHaveBeenCalled());
    expect(screen.getByLabelText(/Entendo que este canal não é oficial/).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByLabelText("Conectar").props.accessibilityState?.disabled).toBe(false);
  });

  it("a tap inside the body does not select the card", async () => {
    const api = client({ ...receivy, instance: pending });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    await screen.findByText("ABCD-1234");
    await fireEvent.press(screen.getByText("ABCD-1234"));

    expect(api.setWhatsappSender).not.toHaveBeenCalled();
  });

  it("guards against a double press on Conectar while the POST is in flight", async () => {
    const api = client({ ...receivy, instance: null });
    let resolveConnect: ((value: typeof pending) => void) | undefined;

    api.connectWhatsapp.mockImplementation(() => new Promise((resolve) => { resolveConnect = resolve; }));
    await render(<WhatsappScreen client={api as never} plans={plans()} />);

    const button = await screen.findByLabelText("Conectar");

    await fireEvent.press(screen.getByLabelText(/Entendo que este canal não é oficial/));
    await fireEvent.press(button);
    await fireEvent.press(button);

    expect(api.connectWhatsapp).toHaveBeenCalledTimes(1);

    resolveConnect?.(pending);
    expect(await screen.findByText("ABCD-1234")).toBeTruthy();
  });

  it("ignores a poll answered after the user already cancelled the pairing", async () => {
    jest.useFakeTimers();

    const api = client({ ...receivy, instance: pending });
    let resolvePoll: ((value: typeof pending) => void) | undefined;
    let resolveDisconnect: (() => void) | undefined;

    api.whatsappInstance.mockImplementation(() => new Promise((resolve) => { resolvePoll = resolve; }));
    api.disconnectWhatsapp.mockImplementation(() => new Promise<void>((resolve) => { resolveDisconnect = resolve; }));
    await render(<WhatsappScreen client={api as never} plans={plans()} />);

    await screen.findByText("ABCD-1234");
    await jest.advanceTimersByTimeAsync(5000);
    expect(api.whatsappInstance).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByLabelText("Cancelar"));
    await jest.advanceTimersByTimeAsync(0);

    // The stale poll answers while `disconnectWhatsapp` itself is still in flight: the polling
    // effect's own `cancelled` flag hasn't flipped yet (the instance is still `pending`, since
    // `patch(null)` only runs once the disconnect resolves), so only the `seqRef` bump made at the
    // top of `disconnect()` can be what discards this response.
    resolvePoll?.({ ...pending, pairingCode: "STALE-CODE" });
    await jest.advanceTimersByTimeAsync(0);

    expect(screen.queryByText("STALE-CODE")).toBeNull();
    expect(screen.getByText("ABCD-1234")).toBeTruthy();

    resolveDisconnect?.();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(0);

    expect(api.disconnectWhatsapp).toHaveBeenCalled();
    expect(screen.getByLabelText(/Entendo que este canal não é oficial/)).toBeTruthy();
    expect(screen.queryByText("ABCD-1234")).toBeNull();
    expect(screen.queryByText("STALE-CODE")).toBeNull();

    await jest.advanceTimersByTimeAsync(10000);
    expect(api.whatsappInstance).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("disconnects the open instance after confirming, back to the initial state", async () => {
    const api = client({ ...receivy, sender: WhatsappSender.Own, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null } });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    await screen.findByText(/Conectado ao/);
    await fireEvent.press(screen.getByLabelText("Desconectar"));

    expect(await screen.findByText("Os lembretes voltam a sair pelo número do Receivy.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Confirmar desconexão"));

    await waitFor(() => expect(api.disconnectWhatsapp).toHaveBeenCalled());
    expect(screen.getByLabelText(/Entendo que este canal não é oficial/)).toBeTruthy();
    expect(screen.getByLabelText("Número do Receivy").props.accessibilityState?.checked).toBe(true);
  });

  it("cancels the pending pairing and returns to the initial state", async () => {
    const api = client({ ...receivy, instance: pending });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    await screen.findByText("ABCD-1234");
    await fireEvent.press(screen.getByLabelText("Cancelar"));

    await waitFor(() => expect(api.disconnectWhatsapp).toHaveBeenCalled());
    expect(screen.getByLabelText(/Entendo que este canal não é oficial/)).toBeTruthy();
  });
});
