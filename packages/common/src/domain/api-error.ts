const messages: Record<string, string> = {
  INVALID_REQUEST: "Confira os dados informados.",
  UNAUTHENTICATED: "Sua sessão expirou. Entre novamente.",
  FORBIDDEN: "Você não tem acesso a esta ação.",
  NOT_FOUND: "Este registro não está disponível.",
  CONFLICT: "O registro mudou ou esta ação já foi realizada. Atualize antes de tentar novamente.",
  RATE_LIMITED: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  INTERNAL_ERROR: "Serviço temporariamente indisponível. Tente novamente.",
};
/** Only stable machine codes cross the client-copy boundary. Never display backend text. */
export function apiErrorMessage(code: unknown, fallback: string): string {
  return typeof code === "string" && Object.hasOwn(messages, code) ? messages[code]! : fallback;
}
