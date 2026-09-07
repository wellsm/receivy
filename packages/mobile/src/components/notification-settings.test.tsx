import { fireEvent, render, screen } from "@testing-library/react-native";
import { NotificationSettings } from "./notification-settings";
import { registerPushDevice } from "@/notifications/register";
jest.mock("@/notifications/register", () => ({
  registerPushDevice: jest.fn(),
}));
it("lets the owner explicitly remove a legacy inactive registration", async () => {
  const client = {
    preferences: jest
      .fn()
      .mockResolvedValue({
        emailEnabled: true,
        pushEnabled: true,
        reminderOffsets: [],
      }),
    devices: jest
      .fn()
      .mockResolvedValue({
        devices: [
          {
            id: "legacy-device",
            platform: "ios",
            active: false,
            createdAt: "2026-09-07",
          },
        ],
      }),
    save: jest.fn(),
    register: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
    remind: jest.fn(),
    deliveries: jest.fn(),
  };
  await render(<NotificationSettings client={client} />);
  await fireEvent.press(await screen.findByLabelText("Remover ios"));
  expect(await screen.findByText("Dispositivo removido.")).toBeOnTheScreen();
  expect(client.remove).toHaveBeenCalledWith("legacy-device");
});
it("saves preferences and registers push only after the explicit action", async () => {
  const client = {
    preferences: jest.fn().mockResolvedValue({
      emailEnabled: true,
      pushEnabled: true,
      reminderOffsets: [-3, 0, 2],
    }),
    devices: jest.fn().mockResolvedValue({ devices: [] }),
    save: jest.fn().mockImplementation(async (input) => input),
    register: jest.fn(),
    remove: jest.fn(),
    remind: jest.fn(),
    deliveries: jest.fn(),
  };
  await render(<NotificationSettings client={client} />);
  expect(await screen.findByText("Salvar notificações")).toBeOnTheScreen();
  expect(registerPushDevice).not.toHaveBeenCalled();
  await fireEvent(
    screen.getByLabelText("Receber e-mail"),
    "valueChange",
    false,
  );
  await fireEvent.press(screen.getByText("Salvar notificações"));
  expect(await screen.findByText("Preferências salvas.")).toBeOnTheScreen();
  expect(client.save).toHaveBeenCalledWith({
    emailEnabled: false,
    pushEnabled: true,
    reminderOffsets: [-3, 0, 2],
  });
  await fireEvent.press(screen.getByText("Ativar push neste dispositivo"));
  expect(
    await screen.findByText(
      "Dispositivo registrado. Isso não confirma a entrega de push.",
    ),
  ).toBeOnTheScreen();
  expect(registerPushDevice).toHaveBeenCalledWith(client.register);
});
