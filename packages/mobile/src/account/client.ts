import type { AuthUser, AccountProfileInput, AccountSession } from "@receivy/common";
import { authClient } from "@/auth/client";
async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await authClient.authenticatedFetch(path, init); if (!response.ok) throw new Error("Não foi possível acessar sua conta."); return response.status === 204 ? undefined as T : response.json(); }
export const accountClient = {
  profile: async () => (await request<{ user: AuthUser }>("auth/me")).user,
  sessions: async () => (await request<{ sessions: AccountSession[] }>("account/sessions")).sessions,
  save: async (input: AccountProfileInput) => (await request<{ user: AuthUser }>("account/profile", { method: "PATCH", body: JSON.stringify(input) })).user,
  revoke: (id: string) => request<void>(`account/sessions/${id}`, { method: "DELETE" }),
  export: async () => { const ticket = await request<{ token: string }>("account/export", { method: "POST" }); return request<{ filename: string; json: string }>("account/export/download", { method: "POST", body: JSON.stringify(ticket) }); },
  erase: async () => { let confirmed = false; try { confirmed = (await request<{ deleted: boolean }>("account", { method: "DELETE", body: JSON.stringify({ confirmation: "EXCLUIR" }) })).deleted === true; } catch {} finally { try { await authClient.logout(); } catch {} } return confirmed; },
  logout: () => authClient.logout(),
};
export type AccountClient = typeof accountClient;
