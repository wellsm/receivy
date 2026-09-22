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
  it("loads the default rule as a sentence, with the disclaimer and the preview, and caps the list at five", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);

    expect(await screen.findByText("no dia")).toBeTruthy();
    expect(screen.getByText("Notificação no app vai sempre que a pessoa permitir no celular dela.")).toBeTruthy();
    expect(screen.getByText(/Push sempre que houver app\./)).toBeTruthy();

    for (let i = 0; i < 4; i++) {
      await fireEvent.press(screen.getByLabelText("E também avisar"));
    }

    expect(screen.queryByLabelText("E também avisar")).toBeNull();
    expect(screen.getByText("5 de 5")).toBeTruthy();
  });

  it("builds the offset with the segmented control and the stepper, capped at 14 days", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Quando avisar no lembrete 1"));
    await fireEvent.press(screen.getByLabelText("antes no lembrete 1"));

    expect(screen.getByText("1 dia antes")).toBeTruthy();

    for (let i = 0; i < 13; i++) {
      await fireEvent.press(screen.getByLabelText("Mais um dia no lembrete 1"));
    }

    expect(screen.getByText("14 dias antes")).toBeTruthy();
    expect(screen.getByLabelText("Mais um dia no lembrete 1").props.accessibilityState.disabled).toBe(true);
  });

  it("saves channels and clears back to the default", async () => {
    // WhatsApp must be both plan-allowed and transport-available to exercise the toggle itself.
    const api = client({ reminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }) });

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Canais do lembrete 1"));
    await fireEvent.press(screen.getByLabelText("e-mail e WhatsApp no lembrete 1"));
    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(api.saveReminders).toHaveBeenCalledWith(expect.objectContaining({ reminders: [expect.objectContaining({ channels: { email: true, whatsapp: true } })] }));

    await fireEvent.press(await screen.findByLabelText("Voltar ao padrão"));

    expect(api.clearReminders).toHaveBeenCalled();
  });

  it("locks WhatsApp on the free plan", async () => {
    await render(<RemindersScreen client={client()} plans={{ plan: jest.fn().mockResolvedValue({ plan: "free", usage: { indefinite: { used: 0, limit: 5 } } }) }} />);

    await fireEvent.press(await screen.findByLabelText("Canais do lembrete 1"));

    expect(screen.getAllByText("Plano Básico").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("WhatsApp no lembrete 1").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("e-mail e WhatsApp no lembrete 1").props.accessibilityState.disabled).toBe(true);
  });

  it("refuses saving with zero rules inline", async () => {
    const api = client();

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("Remover lembrete 1"));
    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(await screen.findByText(/Lembretes inválidos/)).toBeTruthy();
    expect(api.saveReminders).not.toHaveBeenCalled();
  });
});
