export const UNAVAILABLE_MESSAGE = "Serviço indisponível. Tente novamente.";
export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Entre novamente.";
export const STORAGE_BLOCKED_MESSAGE =
  "Seu navegador está bloqueando o armazenamento deste site, então o login não pode ser mantido. Libere o armazenamento ou saia do modo privado e tente novamente.";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The request never got an answer: the API client turns a rejected fetch into this 503. */
export class NetworkError extends ApiError {
  constructor() {
    super(503, UNAVAILABLE_MESSAGE);
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
  }
}

/** The browser refused to store what the login needs (private mode, blocked site data). */
export class StorageBlockedError extends Error {
  constructor() {
    super(STORAGE_BLOCKED_MESSAGE);
  }
}
