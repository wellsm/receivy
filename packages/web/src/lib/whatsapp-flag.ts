import type { ChannelSet } from "@receivy/common";

/** Build-time kill switch: only the literal string "true" turns WhatsApp mentions on. */
export function whatsappEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WHATSAPP_ENABLED === "true";
}

/** The kill switch off reads every channel set as e-mail only, whatever is actually stored. */
export function visibleChannels(channels: ChannelSet): ChannelSet {
  return whatsappEnabled() ? channels : { email: true, whatsapp: false };
}
