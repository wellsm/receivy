/** `phone` is optional and typed by the person at onboarding; the API normalizes it to E.164. */
export type AccountProfileInput = { name: string; phone?: string; locale: 'pt-BR'; timezone: string; country: 'BR' };
export const ACCOUNT_DELETED =
  'Conta excluída no Receivy. Arquivos e avisos pendentes são removidos em segundo plano. Isso não altera registros compartilhados preservados.';
export const ACCOUNT_DELETION_UNCONFIRMED = 'Sessão encerrada; não foi possível confirmar a exclusão.';
