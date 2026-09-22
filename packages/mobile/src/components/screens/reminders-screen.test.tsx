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
  it("loads the default rule with the disclaimer and caps the list at five", async () => {
    await render(<RemindersScreen client={client()} plans={plans} />);

    expect(await screen.findByText("no dia")).toBeTruthy();
    expect(screen.getByText("Notificação no app vai sempre que a pessoa permitir no celular dela.")).toBeTruthy();

    for (let i = 0; i < 4; i++) {
      await fireEvent.press(screen.getByLabelText("Adicionar lembrete"));
    }

    expect(screen.queryByLabelText("Adicionar lembrete")).toBeNull();
  });

  it("saves channels and clears back to the default", async () => {
    // WhatsApp must be both plan-allowed and transport-available to exercise the toggle itself.
    const api = client({ reminders: jest.fn().mockResolvedValue({ config: SYSTEM_REMINDER_CONFIG, inherited: true, whatsappAvailable: true }) });

    await render(<RemindersScreen client={api} plans={plans} />);
    await fireEvent.press(await screen.findByLabelText("WhatsApp no lembrete 1"));
    await fireEvent.press(screen.getByLabelText("Salvar"));

    expect(api.saveReminders).toHaveBeenCalledWith(expect.objectContaining({ reminders: [expect.objectContaining({ channels: { email: true, whatsapp: true } })] }));

    await fireEvent.press(await screen.findByLabelText("Voltar ao padrão"));

    expect(api.clearReminders).toHaveBeenCalled();
  });

  it("locks WhatsApp on the free plan", async () => {
    await render(<RemindersScreen client={client()} plans={{ plan: jest.fn().mockResolvedValue({ plan: "free", usage: { indefinite: { used: 0, limit: 5 } } }) }} />);

    expect(await screen.findByText("Plano Básico")).toBeTruthy();
    expect(screen.getByLabelText("WhatsApp no lembrete 1").props.accessibilityState.disabled).toBe(true);
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
