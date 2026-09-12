import { ConflictError } from '../common/errors';

export class ChargeClosedError extends ConflictError {
  constructor(message = 'A cobrança já foi encerrada.') {
    super(message, 'CHARGE_CLOSED');
  }
}

export class ChargeNotPaidError extends ConflictError {
  constructor(message = 'A cobrança não está paga.') {
    super(message, 'CHARGE_NOT_PAID');
  }
}
