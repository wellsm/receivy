import { PlanTier } from '@receivy/common';
import { ConflictError, PaymentRequiredError, ServiceUnavailableError } from '../common/errors';

const PLAN_NAMES: Record<PlanTier, string> = { [PlanTier.Free]: 'Grátis', [PlanTier.Basic]: 'Básico' };

export class PlanLimitReachedError extends PaymentRequiredError {
  constructor(limit: number, used: number, plan: PlanTier) {
    super(`Você já tem ${used} cobranças indefinidas ativas no plano ${PLAN_NAMES[plan]}.`, 'PLAN_LIMIT_REACHED', { limit: String(limit), used: String(used), plan });
  }
}

export class PlanRequiredError extends PaymentRequiredError {
  constructor(message = 'Links de pagamento fazem parte do plano Básico.') {
    super(message, 'PLAN_REQUIRED');
  }
}

export class PlanAlreadyActiveError extends ConflictError {
  constructor(message = 'Você já tem um plano ativo.') {
    super(message, 'PLAN_ALREADY_ACTIVE');
  }
}

export class PlanBillingDisabledError extends ServiceUnavailableError {
  constructor(message = 'Assinaturas não estão disponíveis neste ambiente.') {
    super(message, 'PLAN_BILLING_DISABLED');
  }
}

export class PlanUnavailableError extends ServiceUnavailableError {
  constructor(message = 'Não deu para falar com o Stripe agora. Tente de novo em instantes.') {
    super(message, 'PLAN_UNAVAILABLE');
  }
}
