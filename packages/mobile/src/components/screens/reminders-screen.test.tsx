import { fireEvent, render, screen } from "@testing-library/react-native";
import { SYSTEM_REMINDER_CONFIG } from "@receivy/common";
import { RemindersScreen } from "./reminders-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (effect: () => void) => react.useEffect(effect, []), useRouter: () => ({ back: jest.fn() }) };
});

function client(overrides: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(), ...overrides };
}

function base() {
  return {
    reminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }),
    saveReminders: jest.fn().mockImplementation(async (config) => ({ config, inherited: false, whatsappAvailable: false })),
    clearReminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: false }),
  };
}

const plans = { plan: jest.fn().mockResolvedValue({ plan: "basic", usage: { indefinite: { used: 0, limit: 30 } } }) };

describe("RemindersScreen", () => {
  // Every existing test assumes the channel chips exist; the kill-switch tests flip the flag off themselves.
  beforeEach(() => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_WHATSAPP_ENABLED;
  });

  it("puts the default rule on the ruler and lists it with its channels", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);

    expect((await screen.findByLabelText("Lembrete 1")).props.accessibilityValue.now).toBe(0);
    expect(screen.getByText("O AVISO")).toBeTruthy();
    expect(screen.getByText("email · push")).toBeTruthy();
    expect(screen.getByText(/Sempre às 6h no fuso da conta/)).toBeTruthy();
  });

  it("creates a rule from a free dot and fills the ruler up to five", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Criar lembrete 3 dias antes"));

    expect(screen.getByText("OS 2 AVISOS")).toBeTruthy();
    expect(screen.getByLabelText("Lembrete 2").props.accessibilityValue.now).toBe(-3);

    for (const label of ["Criar lembrete 14 dias antes", "Criar lembrete 7 dias antes", "Criar lembrete 1 dia antes"]) {
      await fireEvent.press(screen.getByLabelText(label));
    }

    expect(screen.getByText("5 de 5")).toBeTruthy();
    expect(screen.getByLabelText("Criar lembrete 2 dias depois").props.accessibilityState.disabled).toBe(true);
  });

  it("moves a pin a day at a time through its adjustable actions", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);

    const pin = await screen.findByLabelText("Lembrete 1");

    await fireEvent(pin, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });

    expect(screen.getByLabelText("Lembrete 1").props.accessibilityValue.now).toBe(-1);
  });

  it("pauses a rule from its row", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);
    await fireEvent(await screen.findByLabelText("Lembrete 1 ativo"), "valueChange", false);

    expect(screen.getByText("pausado")).toBeTruthy();
  });

  it("saves channels and clears back to the default", async () => {
    // WhatsApp must be both plan-allowed and transport-available to exercise the toggle itself.
    const api = client({ reminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }) });

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Editar lembrete 1"));
    await fireEvent.press(screen.getByLabelText("whatsapp no lembrete 1"));
    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(api.saveReminders).toHaveBeenCalledWith(expect.objectContaining({ reminders: [expect.objectContaining({ channels: { email: false, whatsapp: true } })] }));

    await fireEvent.press(await screen.findByLabelText("Voltar ao padrão"));

    expect(api.clearReminders).toHaveBeenCalled();
  });

  it("locks WhatsApp on the free plan", async () => {
    await render(<RemindersScreen client={client()} plans={{ plan: jest.fn().mockResolvedValue({ plan: "free", usage: { indefinite: { used: 0, limit: 5 } } }) }} />);

    await fireEvent.press(await screen.findByLabelText("Editar lembrete 1"));

    expect(screen.getAllByText("Plano Básico").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("whatsapp no lembrete 1").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("email no lembrete 1").props.accessibilityState.disabled).toBe(false);
  });

  it("refuses saving with zero rules inline", async () => {
    const api = client();

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Editar lembrete 1"));
    await fireEvent.press(screen.getByLabelText("Remover lembrete 1"));
    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(await screen.findByText(/Lembretes inválidos/)).toBeTruthy();
    expect(api.saveReminders).not.toHaveBeenCalled();
  });

  it("hides the channel chips and the manual section, and saves whatsapp rules back as e-mail, when the kill switch is off", async () => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "false";

    const api = client({
      reminders: jest.fn().mockResolvedValue({
        config: {
          reminders: [{ offsetDays: 0, enabled: true, channels: { email: false, whatsapp: true } }],
          manual: { email: true, whatsapp: true },
        },
        inherited: true,
        whatsappAvailable: true,
      }),
    });

    await render(<RemindersScreen client={api} plans={plans} />);

    expect(await screen.findByText("email · push")).toBeTruthy();
    expect(screen.queryByText("LEMBRETE MANUAL")).toBeNull();

    await fireEvent.press(await screen.findByLabelText("Editar lembrete 1"));

    expect(screen.queryByLabelText("whatsapp no lembrete 1")).toBeNull();
    expect(screen.queryByLabelText("email no lembrete 1")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(api.saveReminders).toHaveBeenCalledWith(
      expect.objectContaining({
        reminders: [expect.objectContaining({ channels: { email: true, whatsapp: false } })],
        manual: { email: true, whatsapp: false },
      }),
    );
  });

  it("keeps the WhatsApp channel option with only the Evolution flag on", async () => {
    process.env.EXPO_PUBLIC_WHATSAPP_ENABLED = "false";
    process.env.EXPO_PUBLIC_EVOLUTION_ENABLED = "true";

    const api = client({ reminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }) });

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Editar lembrete 1"));

    expect(screen.getByLabelText("whatsapp no lembrete 1")).toBeTruthy();

    delete process.env.EXPO_PUBLIC_EVOLUTION_ENABLED;
  });
});
