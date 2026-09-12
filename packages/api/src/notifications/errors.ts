import { ConflictError, RateLimitedError } from '../common/errors';

export class DeviceOwnedElsewhereError extends ConflictError {
  constructor(message = 'O dispositivo deve ser removido da conta anterior.') {
    super(message, 'DEVICE_OWNED_ELSEWHERE');
  }
}

export class DeviceRegisteredError extends ConflictError {
  constructor(message = 'Dispositivo já registrado.') {
    super(message, 'DEVICE_REGISTERED');
  }
}

export class ReminderQuotaError extends RateLimitedError {
  constructor(message = 'Aguarde 24 horas antes de enviar outro lembrete.') {
    super(message, 'REMINDER_QUOTA');
  }
}
