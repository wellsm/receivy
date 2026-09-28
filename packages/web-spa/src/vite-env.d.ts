/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string | undefined;
  readonly VITE_PROOF_UPLOAD_ORIGIN: string | undefined;
  readonly VITE_OPERATOR_CONTACT: string | undefined;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string | undefined;
  readonly VITE_PLAN_BASIC_PRICE_CENTS: string | undefined;
  readonly VITE_WHATSAPP_ENABLED: string | undefined;
  readonly VITE_EVOLUTION_ENABLED: string | undefined;
}
