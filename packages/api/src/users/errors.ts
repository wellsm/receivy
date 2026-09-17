import { AVATAR_INVALID_MESSAGE } from '@receivy/common';
import { ConflictError, UnprocessableEntityError } from '../common/errors';

export class AvatarInvalidError extends UnprocessableEntityError {
  constructor() {
    super(AVATAR_INVALID_MESSAGE, 'AVATAR_INVALID');
  }
}

/**
 * The refresh token was consumed moments ago, so a sibling client won the rotation race and the
 * session is alive. Clients retry with the pair they now hold; a later reuse is a replay instead.
 */
export class StaleSessionError extends ConflictError {
  constructor(message = 'Sessão renovada em outra janela. Tente novamente.') {
    super(message, 'STALE_SESSION');
  }
}
