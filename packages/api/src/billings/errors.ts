import { ConflictError } from '../common/errors';

export class IdempotencyMismatchError extends ConflictError {
  constructor(message = 'Idempotency-Key já usada com outro conteúdo.') {
    super(message, 'IDEMPOTENCY_MISMATCH');
  }
}

export class BillingPreviewUnavailableError extends ConflictError {
  constructor(message = 'Só cobranças sem fim têm projeção.') {
    super(message, 'BILLING_PREVIEW_UNAVAILABLE');
  }
}

export class BillingEndedError extends ConflictError {
  constructor(message = 'Conta encerrada não aceita edição.') {
    super(message, 'BILLING_ENDED');
  }
}

export class BillingNotPausableError extends ConflictError {
  constructor(message = 'Só contas sem fim podem ser pausadas.') {
    super(message, 'BILLING_NOT_PAUSABLE');
  }
}

export class PayableHasNoSplitError extends ConflictError {
  constructor(message = 'Uma conta a pagar não tem divisão nem chave da sua carteira.') {
    super(message, 'PAYABLE_HAS_NO_SPLIT');
  }
}

export class ReceivableHasNoPayeeError extends ConflictError {
  constructor(message = 'Só uma conta a pagar tem chave digitada e credor.') {
    super(message, 'RECEIVABLE_HAS_NO_PAYEE');
  }
}

export class BillingSnapshotLockedError extends ConflictError {
  constructor(message = 'Contas já geradas são snapshot: só lembretes, Pix e encerramento podem mudar.') {
    super(message, 'BILLING_SNAPSHOT_LOCKED');
  }
}

export class GuestAlreadyResolvedError extends ConflictError {
  constructor(message = 'Esse convidado já foi resolvido.') {
    super(message, 'GUEST_ALREADY_RESOLVED');
  }
}

export class BillingInactiveError extends ConflictError {
  constructor(message = 'Essa conta não está mais ativa.') {
    super(message, 'BILLING_INACTIVE');
  }
}
