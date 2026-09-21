import type {
  DeviceRegistration,
  ManualReminderResult,
  NotificationDevice,
} from "@receivy/common";
import { authClient } from "@/auth/client";
import { apiErrorMessage, REMINDER_QUOTA_MESSAGE } from "@receivy/common";

export function createNotificationClient(
  authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>,
) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authenticatedFetch(path, init);

    if (!response.ok) {
      const fallback = "Não foi possível acessar notificações.";
      let message = response.status === 429 ? REMINDER_QUOTA_MESSAGE : fallback;

      try {
        const body = await response.json();

        message = response.status === 429 ? message : apiErrorMessage(response.status, body, fallback);
      } catch {}

      throw new Error(message);
    }

    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }

  return {
    register: (input: DeviceRegistration) =>
      request<NotificationDevice>("devices", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    remind: (id: string) =>
      request<ManualReminderResult>(`charges/${id}/reminders`, {
        method: "POST",
      }),
    remindPreview: (id: string) =>
      request<ManualReminderResult>(`charges/${id}/reminders/preview`),
  };
}

export const notificationClient = createNotificationClient(
  authClient.authenticatedFetch,
);

export type NotificationClient = ReturnType<typeof createNotificationClient>;
