/** Build-time kill switch: only the literal string "true" turns WhatsApp mentions on. */
export function whatsappEnabled(): boolean {
  return process.env.EXPO_PUBLIC_WHATSAPP_ENABLED === "true";
}
