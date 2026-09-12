import { ConflictError } from '../common/errors';

export class InviteOwnerError extends ConflictError {
  constructor(message = 'Você é o dono desta cobrança.') {
    super(message, 'INVITE_OWNER');
  }
}

export class SplitClosedError extends ConflictError {
  constructor(message = 'Esse rateio não aceita novos participantes.') {
    super(message, 'SPLIT_CLOSED');
  }
}

export class SplitInProgressError extends ConflictError {
  constructor(message = 'Divisão já em andamento.') {
    super(message, 'SPLIT_IN_PROGRESS');
  }
}

export class InviteBillingInactiveError extends ConflictError {
  constructor(message = 'Só contas ativas aceitam convite.') {
    super(message, 'INVITE_BILLING_INACTIVE');
  }
}

export class PayableHasNoInviteError extends ConflictError {
  constructor(message = 'Uma conta a pagar não aceita convite.') {
    super(message, 'PAYABLE_HAS_NO_INVITE');
  }
}
