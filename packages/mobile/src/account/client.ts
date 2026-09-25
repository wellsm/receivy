import type { AuthUser, AccountProfileInput, AvatarMime, AvatarUploadTicket, ReminderConfig, ReminderSettings, UserAvatar, WhatsappInstanceView, WhatsappSender, WhatsappSettings } from "@receivy/common";
import { apiErrorMessage } from "@receivy/common";
import { authClient } from "@/auth/client";

const LOAD_ERROR = "Não foi possível acessar sua conta.";

async function message(response: Response, fallback: string) {
  try {
    return apiErrorMessage(response.status, await response.json(), fallback);
  } catch {
    return apiErrorMessage(response.status, null, fallback);
  }
}

async function request<T>(path: string, init?: RequestInit, fallback = LOAD_ERROR): Promise<T> { const response = await authClient.authenticatedFetch(path, init);

 if (!response.ok) {
  throw new Error(await message(response, fallback));
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
  whatsapp: () => request<WhatsappSettings>("whatsapp", undefined, "Não foi possível carregar o WhatsApp."),
  whatsappInstance: (refresh = false) =>
    request<{ instance: WhatsappInstanceView | null }>(`whatsapp/instance${refresh ? "?refresh=true" : ""}`, undefined, "Não foi possível carregar o WhatsApp.").then(
      (body) => body.instance,
    ),
  connectWhatsapp: (input: { riskAccepted: true; phone: string }) => request<WhatsappInstanceView>("whatsapp/instance", { method: "POST", body: JSON.stringify(input) }, "Não deu para conectar agora."),
  disconnectWhatsapp: () => request<void>("whatsapp/instance", { method: "DELETE" }, "Não deu para desconectar agora."),
  setWhatsappSender: (sender: WhatsappSender) => request<{ sender: WhatsappSender }>("whatsapp/sender", { method: "PATCH", body: JSON.stringify({ sender }) }, "Não deu para trocar o remetente.").then((body) => body.sender),
};

export type AccountClient = typeof accountClient;
