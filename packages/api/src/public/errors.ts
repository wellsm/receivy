import { ConflictError } from '../common/errors';

export class PixRequiredError extends ConflictError {
  constructor(message = 'Escolha uma chave Pix antes de publicar o link.') {
    super(message, 'PIX_REQUIRED');
  }
}

export class PixSnapshotLockedError extends ConflictError {
  constructor(message = 'A chave Pix publicada não pode ser trocada.') {
    super(message, 'PIX_SNAPSHOT_LOCKED');
  }
}
