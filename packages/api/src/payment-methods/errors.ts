import { ConflictError, ServiceUnavailableError, UnprocessableEntityError } from '../common/errors';

export class PaymentMethodTakenError extends ConflictError {
  constructor(message = 'Esse meio de pagamento já está cadastrado.') {
    super(message, 'PAYMENT_METHOD_TAKEN');
  }
}

/** InfinitePay refused the handle: it does not exist, or its external checkout is off. `fields.redirectUrl` opens the switch. */
export class InfinitePayCheckoutDisabledError extends UnprocessableEntityError {
  constructor(redirectUrl: string, message = 'Ative o checkout externo no app da InfinitePay e tente de novo.') {
    super(message, 'INFINITEPAY_CHECKOUT_DISABLED', { redirectUrl });
  }
}

export class PaymentLinkUnavailableError extends ServiceUnavailableError {
  constructor(message = 'Não deu para falar com a InfinitePay agora. Tente de novo em instantes.') {
    super(message, 'PAYMENT_LINK_UNAVAILABLE');
  }
}
