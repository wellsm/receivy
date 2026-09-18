import { registerPushDevice } from "./register";
import * as Notifications from "expo-notifications";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue("installation"),
  setItemAsync: jest.fn(),
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { easConfig: { projectId: "project-id" } },
}));
it("does not register without permission and forwards the actual Expo token after consent", async () => {
  const register = jest
    .fn()
    .mockResolvedValue({
      id: "device",
      active: true,
      platform: "ios",
      createdAt: "2026-09-07",
    });

  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({
      status: "denied",
    } as Notifications.NotificationPermissionsStatus);
  jest
    .mocked(Notifications.requestPermissionsAsync)
    .mockResolvedValue({
      status: "denied",
    } as Notifications.NotificationPermissionsStatus);

  await expect(registerPushDevice(register)).rejects.toThrow(/Permissão/);

  expect(register).not.toHaveBeenCalled();
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue({
      status: "granted",
    } as Notifications.NotificationPermissionsStatus);
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({
      type: "expo",
      data: "ExpoPushToken[actual-test-token]",
    });

  await registerPushDevice(register);

  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({
      token: "ExpoPushToken[actual-test-token]",
      installationId: "installation",
    }),
  );
});
