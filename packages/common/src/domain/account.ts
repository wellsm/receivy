export type AccountProfileInput = { name: string; locale: "pt-BR"; timezone: string; country: "BR" };
export type AccountSession = { id: string; deviceName: string; createdAt: string; lastSeenAt: string; current: boolean };
export const ACCOUNT_DELETED = "Conta excluída no Receivy. A remoção de arquivos e a revogação Apple podem continuar em segundo plano. Se usou Apple, confira Ajustes > seu nome > Início de Sessão e Segurança > Iniciar sessão com a Apple e remova o Receivy caso ainda apareça. Isso não altera registros compartilhados preservados.";
export const ACCOUNT_DELETION_UNCONFIRMED = "Sessão encerrada; não foi possível confirmar a exclusão.";
