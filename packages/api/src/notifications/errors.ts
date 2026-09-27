import { ConflictError, PaymentRequiredError, RateLimitedError, ServiceUnavailableError } from '../common/errors';

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

export class WhatsappPlanRequiredError extends PaymentRequiredError {
  constructor(message = 'Enviar pelo seu número faz parte do plano Básico.') {
    super(message, 'PLAN_REQUIRED');
  }
}

export class WhatsappInstanceUnavailableError extends ServiceUnavailableError {
  constructor(message = 'Não deu para falar com o WhatsApp agora. Tente de novo em instantes.') {
    super(message, 'WHATSAPP_INSTANCE_UNAVAILABLE');
  }
}

export class WhatsappInstanceRequiredError extends ConflictError {
  constructor(message = 'Conecte seu número antes de escolher enviar por ele.') {
    super(message, 'WHATSAPP_INSTANCE_REQUIRED');
  }
}

export class WhatsappGroupsRequireInstanceError extends ConflictError {
  constructor(message = 'Conecte seu número de WhatsApp para avisar num grupo.') {
    super(message, 'WHATSAPP_INSTANCE_REQUIRED');
  }
}
