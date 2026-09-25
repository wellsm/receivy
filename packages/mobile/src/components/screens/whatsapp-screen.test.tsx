import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappSettings } from "@receivy/common";
import { WhatsappScreen } from "./whatsapp-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (effect: () => void) => react.useEffect(effect, []), useRouter: () => ({ back: jest.fn(), push: jest.fn() }) };
});

const receivy: WhatsappSettings = { available: true, sender: WhatsappSender.Receivy, instance: null, quota: { used: 37, limit: 150, cycleEnd: "2026-10-12T03:00:00.000Z" } };

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
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_WHATSAPP_ENABLED;
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
    const api = client({ ...receivy, sender: WhatsappSender.Own, instance: { state: WhatsappInstanceState.Open, phone: "5511988887777", qr: null, pairingCode: null, connectedAt: "2026-09-25T12:00:00.000Z" } });

    await render(<WhatsappScreen client={api as never} plans={plans()} />);
    await screen.findByText(/Conectado ao/);
    await fireEvent.press(screen.getByLabelText("Número do Receivy"));

    await waitFor(() => expect(api.setWhatsappSender).toHaveBeenCalledWith(WhatsappSender.Receivy));
    expect(screen.getByText(/Conectado ao/)).toBeTruthy();
  });

  it("renders nothing with the kill switch off", async () => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "false";

    const { toJSON } = await render(<WhatsappScreen client={client() as never} plans={plans()} />);

    expect(toJSON()).toBeNull();
  });
});
