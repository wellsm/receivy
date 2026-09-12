import { ConflictError } from '../common/errors';

export class PixKeyTakenError extends ConflictError {
  constructor(message = 'Esta chave Pix já foi cadastrada.') {
    super(message, 'PIX_KEY_TAKEN');
  }
}
