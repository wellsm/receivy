import { ApiError } from "@/lib/api/errors";

const MESSAGES: Record<number, string> = {
  409: "Esse e-mail já está em uso: por outro contato seu ou por uma conta ativa. Só o apelido de um contato ativo pode mudar.",
  404: "Contato não encontrado.",
  400: "Confira o nome e o e-mail informados.",
};

export function contactErrorMessage(error: unknown): string {
  if (error instanceof ApiError && MESSAGES[error.status]) {
    return MESSAGES[error.status]!;
  }

  return "Não foi possível acessar seus contatos.";
}
