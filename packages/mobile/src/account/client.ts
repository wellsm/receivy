import type { AuthUser, AccountProfileInput, AvatarMime, AvatarUploadTicket, ReminderConfig, ReminderSettings, UserAvatar } from "@receivy/common";
import { authClient } from "@/auth/client";

async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await authClient.authenticatedFetch(path, init);

 if (!response.ok) {
  throw new Error("Não foi possível acessar sua conta.");
}

 return response.status === 204 ? undefined as T : response.json(); }

export const accountClient = {
  profile: async () => (await request<{ user: AuthUser }>("auth/me")).user,
  save: async (input: AccountProfileInput & { phone?: string }) => (await request<{ user: AuthUser }>("account/profile", { method: "PATCH", body: JSON.stringify(input) })).user,
  erase: async () => { let confirmed = false;

 try { confirmed = (await request<{ deleted: boolean }>("account", { method: "DELETE", body: JSON.stringify({ confirmation: "EXCLUIR" }) })).deleted === true; } catch {} finally { try { await authClient.logout(); } catch {} }

 return confirmed; },
  logout: () => authClient.logout(),
  startAvatarUpload: (mime: AvatarMime) => request<AvatarUploadTicket>("account/avatar", { method: "POST", body: JSON.stringify({ mime }) }),
  completeAvatarUpload: async () => (await request<{ avatar: UserAvatar }>("account/avatar/complete", { method: "POST" })).avatar,
  reminders: () => request<ReminderSettings>("account/reminders"),
  saveReminders: (config: ReminderConfig) => request<ReminderSettings>("account/reminders", { method: "PUT", body: JSON.stringify(config) }),
  clearReminders: () => request<ReminderSettings>("account/reminders", { method: "DELETE" }),
};

export type AccountClient = typeof accountClient;
