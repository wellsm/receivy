export type AppEnv = {
  apiUrl: string;
  proofUploadOrigin: string | null;
  avatarOrigin: string | null;
  operatorContact: string;
  stripePublishableKey: string;
  planBasicPriceCents: number | null;
  whatsappEnabled: boolean;
  evolutionEnabled: boolean;
};

function flag(value: string | undefined): boolean {
  return value === "true";
}

export function readEnv(): AppEnv {
  const apiUrl = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new Error("VITE_API_URL is not configured: copy .env.example to .env.local.");
  }

  const price = Number(import.meta.env.VITE_PLAN_BASIC_PRICE_CENTS);

  return {
    apiUrl,
    proofUploadOrigin: import.meta.env.VITE_PROOF_UPLOAD_ORIGIN?.trim() || null,
    avatarOrigin: import.meta.env.VITE_AVATAR_ORIGIN?.trim() || null,
    operatorContact: import.meta.env.VITE_OPERATOR_CONTACT ?? "",
    stripePublishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "",
    planBasicPriceCents: Number.isInteger(price) && price > 0 ? price : null,
    whatsappEnabled: flag(import.meta.env.VITE_WHATSAPP_ENABLED),
    evolutionEnabled: flag(import.meta.env.VITE_EVOLUTION_ENABLED),
  };
}
