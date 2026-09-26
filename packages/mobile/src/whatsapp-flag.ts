import { PlanTier, WhatsappInstanceState, WhatsappSender, type ChannelSet, type WhatsappSettings } from "@receivy/common";

/** Build-time flag: only the literal string "true" turns the Receivy number (Meta) option on. */
export function receivyEnabled(): boolean {
  return process.env.EXPO_PUBLIC_WHATSAPP_ENABLED === "true";
}

/** Build-time flag: only the literal string "true" turns the own number (Evolution) option on. */
export function evolutionEnabled(): boolean {
  return process.env.EXPO_PUBLIC_EVOLUTION_ENABLED === "true";
}

/** Build-time kill switch: on when either sender option is on. */
export function whatsappEnabled(): boolean {
  return receivyEnabled() || evolutionEnabled();
}

/** The kill switch off reads every channel set as e-mail only, whatever is actually stored. */
export function visibleChannels(channels: ChannelSet): ChannelSet {
  return whatsappEnabled() ? channels : { email: true, whatsapp: false };
}

/** The hub row subtitle, one line per state (spec §4, mirrors `whatsapp-client.ts` on web). */
export function whatsappSubtitle(
  settings: WhatsappSettings | null,
  plan: PlanTier | null,
  options: { receivy: boolean; evolution: boolean } = { receivy: receivyEnabled(), evolution: evolutionEnabled() },
): string {
  if (!settings || !settings.available) {
    return "Em breve";
  }

  if (plan === PlanTier.Free) {
    return "Disponível no plano Básico";
  }

  if (options.receivy && settings.sender === WhatsappSender.Receivy) {
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

  if (options.evolution && !options.receivy) {
    return "Conecte seu número";
  }

  return "Pelo seu número";
}
