export const UNAVAILABLE_MESSAGE = "Serviço indisponível. Tente novamente.";
export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Entre novamente.";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
  }
}
