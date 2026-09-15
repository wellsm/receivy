import { ConflictError, ForbiddenError, UnprocessableEntityError } from '../common/errors';

export class ProofPendingError extends ConflictError {
  constructor(message = 'Já existe um comprovante em revisão.') {
    super(message, 'PROOF_PENDING');
  }
}

export class UploadInProgressError extends ConflictError {
  constructor(message = 'Já existe um envio em andamento.') {
    super(message, 'UPLOAD_IN_PROGRESS');
  }
}

export class UploadMissingError extends ConflictError {
  constructor(message = 'Nenhum envio em andamento. Selecione o arquivo e envie novamente.') {
    super(message, 'UPLOAD_MISSING');
  }
}

export class ProofReviewedError extends ConflictError {
  constructor(message = 'O comprovante já foi revisado.') {
    super(message, 'PROOF_REVIEWED');
  }
}

export class ProofMissingError extends ConflictError {
  constructor(message = 'Não há comprovante em revisão.') {
    super(message, 'PROOF_MISSING');
  }
}

export class ProofInvalidFileError extends UnprocessableEntityError {
  constructor(message = 'Envie um arquivo JPG, PNG ou PDF válido.') {
    super(message, 'PROOF_INVALID_FILE');
  }
}

export class ProofTooLargeError extends UnprocessableEntityError {
  constructor(message = 'O comprovante deve ter no máximo 10 MB.') {
    super(message, 'PROOF_TOO_LARGE');
  }
}

export class ProofSizeMismatchError extends UnprocessableEntityError {
  constructor(message = 'O tamanho do arquivo não corresponde ao envio autorizado.') {
    super(message, 'PROOF_SIZE_MISMATCH');
  }
}

export class ProofReviewInvalidError extends UnprocessableEntityError {
  constructor(message = 'Informe aceitar ou recusar e um motivo de até 500 caracteres.') {
    super(message, 'PROOF_REVIEW_INVALID');
  }
}

export class ProofDeclarationForbiddenError extends ForbiddenError {
  constructor(message = 'Só quem paga pode informar o pagamento, e só quando o outro lado pode confirmar.') {
    super(message, 'PROOF_DECLARATION_FORBIDDEN');
  }
}
