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

export class ChargeInReviewError extends ConflictError {
  constructor(message = 'A cobrança está em análise. Aguarde a resposta sobre o pagamento informado.') {
    super(message, 'CHARGE_IN_REVIEW');
  }
}

export class SettledNoRemindersError extends ConflictError {
  constructor(message = 'Registros não têm avisos.') {
    super(message, 'SETTLED_NO_REMINDERS');
  }
}

export class SilenceUnavailableError extends ConflictError {
  constructor(message = 'Só uma conta a receber tem avisos automáticos para pausar.') {
    super(message, 'SILENCE_UNAVAILABLE');
  }
}
