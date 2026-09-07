import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { DeviceRegistration, NotificationDevice } from "@receivy/common";

/** Explicit user action only; credentials/project and a physical development build are required. */
export async function registerPushDevice(
  register: (input: DeviceRegistration) => Promise<NotificationDevice>,
) {
  if (!Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android"))
    throw new Error(
      "Push requer o aplicativo em um dispositivo iOS ou Android físico.",
    );
  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId)
    throw new Error(
      "Configure o projeto Expo e as credenciais de push no build do aplicativo.",
    );
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Cobranças",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted")
    permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Permissão de notificações não concedida. Você pode manter e-mail ativo.",
    );
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  let installationId = await SecureStore.getItemAsync(
    "receivy.push.installation",
  );
  if (!installationId) {
    installationId = Crypto.randomUUID();
    await SecureStore.setItemAsync("receivy.push.installation", installationId);
  }
  return register({ token, installationId, platform: Platform.OS });
}
