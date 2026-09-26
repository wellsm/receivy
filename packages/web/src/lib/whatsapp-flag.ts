import type { ChannelSet } from "@receivy/common";

/** Build-time flag: only the literal string "true" turns the Receivy number (Meta) option on. */
export function receivyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WHATSAPP_ENABLED === "true";
}

/** Build-time flag: only the literal string "true" turns the own number (Evolution) option on. */
export function evolutionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_EVOLUTION_ENABLED === "true";
}

/** Build-time kill switch: on when either sender option is on. */
export function whatsappEnabled(): boolean {
  return receivyEnabled() || evolutionEnabled();
}

/** The kill switch off reads every channel set as e-mail only, whatever is actually stored. */
export function visibleChannels(channels: ChannelSet): ChannelSet {
  return whatsappEnabled() ? channels : { email: true, whatsapp: false };
}
