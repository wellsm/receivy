import type {
  DeviceRegistration,
  NotificationDelivery,
  NotificationDevice,
  NotificationPreferences,
} from "@receivy/common";
import { authClient } from "@/auth/client";
import { apiErrorMessage } from "@receivy/common";
export function createNotificationClient(
  authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>,
) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authenticatedFetch(path, init);
    if (!response.ok) {
      let message = "Não foi possível acessar notificações.";
      try {
        const body = (await response.json()) as { code?: unknown };
        message = apiErrorMessage(body.code, message);
      } catch {}
      throw new Error(message);
    }
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  return {
    preferences: () =>
      request<NotificationPreferences>("notification-preferences"),
    save: (input: NotificationPreferences) =>
      request<NotificationPreferences>("notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    devices: () => request<{ devices: NotificationDevice[] }>("devices"),
    register: (input: DeviceRegistration) =>
      request<NotificationDevice>("devices", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      request<void>(`devices/${id}`, { method: "DELETE" }),
    remind: (id: string) =>
      request<{ queued: boolean }>(`charges/${id}/reminders`, {
        method: "POST",
      }),
    deliveries: (id: string) =>
      request<{ deliveries: NotificationDelivery[] }>(
        `charges/${id}/deliveries`,
      ),
  };
}
export const notificationClient = createNotificationClient(
  authClient.authenticatedFetch,
);
export type NotificationClient = ReturnType<typeof createNotificationClient>;
