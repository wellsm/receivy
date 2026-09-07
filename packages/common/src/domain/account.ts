export type AccountProfileInput = { name: string; locale: "pt-BR"; timezone: string; country: "BR" };
export type AccountSession = { id: string; deviceName: string; createdAt: string; lastSeenAt: string; current: boolean };
export const ACCOUNT_DELETED = "Conta excluída. A remoção de arquivos será concluída em segundo plano.";
export const ACCOUNT_DELETION_UNCONFIRMED = "Sessão encerrada; não foi possível confirmar a exclusão.";
