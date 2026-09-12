import { ConflictError } from '../common/errors';

export const LINKED_CONTACT_MESSAGE = 'Contato vinculado a uma conta: só o apelido pode mudar.';
export const DUPLICATE_CONTACT_MESSAGE = 'Já existe um contato ativo com esse e-mail.';
export const EMAIL_TAKEN_MESSAGE = 'Já existe uma conta com esse e-mail. Cadastre o contato com o e-mail correto.';
export const NOT_LINKABLE_MESSAGE = 'Só um contato sem e-mail pode receber um convidado.';

export class LinkedContactError extends ConflictError {
  constructor() {
    super(LINKED_CONTACT_MESSAGE, 'CONTACT_LINKED');
  }
}

export class DuplicateContactError extends ConflictError {
  constructor() {
    super(DUPLICATE_CONTACT_MESSAGE, 'CONTACT_DUPLICATE');
  }
}

export class EmailTakenError extends ConflictError {
  constructor() {
    super(EMAIL_TAKEN_MESSAGE, 'CONTACT_EMAIL_TAKEN');
  }
}

export class OwnEmailError extends ConflictError {
  constructor() {
    super('Esse e-mail é o da sua própria conta.', 'CONTACT_OWN_EMAIL');
  }
}

export class NotLinkableError extends ConflictError {
  constructor() {
    super(NOT_LINKABLE_MESSAGE, 'CONTACT_NOT_LINKABLE');
  }
}
