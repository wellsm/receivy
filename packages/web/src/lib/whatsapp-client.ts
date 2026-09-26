import { PlanTier, WhatsappInstanceState, WhatsappSender, type WhatsappInstanceView, type WhatsappSettings } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { responseMessage } from "@/lib/financial-response";
import { evolutionEnabled, receivyEnabled } from "@/lib/whatsapp-flag";

const LOAD_ERROR = "Não foi possível carregar o WhatsApp.";

async function request<T>(path: string, init?: RequestInit, fallback = LOAD_ERROR): Promise<T> {
  const response = await browserFetch(`/api/financial/${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });

  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type ConnectInput = { riskAccepted: true; phone?: string };

export const whatsappClient = {
  settings: () => request<WhatsappSettings>("whatsapp"),
  instance: (refresh = false) =>
    request<{ instance: WhatsappInstanceView | null }>(`whatsapp/instance${refresh ? "?refresh=true" : ""}`).then((body) => body.instance),
  connect: (input: ConnectInput) =>
    request<WhatsappInstanceView>("whatsapp/instance", { method: "POST", body: JSON.stringify(input) }, "Não deu para conectar agora."),
  disconnect: () => request<void>("whatsapp/instance", { method: "DELETE" }, "Não deu para desconectar agora."),
  setSender: (sender: WhatsappSender) =>
    request<{ sender: WhatsappSender }>("whatsapp/sender", { method: "PATCH", body: JSON.stringify({ sender }) }, "Não deu para trocar o remetente.").then((body) => body.sender),
};

export type WhatsappClient = typeof whatsappClient;

/** The hub row subtitle, one line per state (spec §4). */
export function whatsappSubtitle(
  settings: WhatsappSettings | null,
  plan: PlanTier | null,
  options: { receivy: boolean; evolution: boolean } = { receivy: receivyEnabled(), evolution: evolutionEnabled() },
): string {
  if (!settings) {
    return "Em breve";
  }

  const receivyUsable = options.receivy && settings.available;
  const ownUsable = options.evolution && settings.ownAvailable;

  if (!receivyUsable && !ownUsable) {
    return "Em breve";
  }

  if (plan === PlanTier.Free) {
    return "Disponível no plano Básico";
  }

  // Without a usable own option, a stored own sender still reads as the Receivy line.
  if (receivyUsable && (settings.sender === WhatsappSender.Receivy || !ownUsable)) {
    return settings.quota
      ? `Pelo número do Receivy · ${settings.quota.used} de ${settings.quota.limit} neste ciclo`
      : "Pelo número do Receivy";
  }

  const instance = settings.instance;

  if (instance?.state === WhatsappInstanceState.Open) {
    return "Pelo seu número · conectado";
  }

  if (instance?.state === WhatsappInstanceState.Pending) {
    return "Pelo seu número · aguardando pareamento";
  }

  if (instance?.state === WhatsappInstanceState.Closed) {
    return "Seu número desconectou";
  }

  if (!receivyUsable) {
    return "Conecte seu número";
  }

  return "Pelo seu número";
}
