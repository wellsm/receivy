import { AVATAR_INVALID_MESSAGE } from '@receivy/common';
import { UnprocessableEntityError } from '../common/errors';

export class AvatarInvalidError extends UnprocessableEntityError {
  constructor() {
    super(AVATAR_INVALID_MESSAGE, 'AVATAR_INVALID');
  }
}
