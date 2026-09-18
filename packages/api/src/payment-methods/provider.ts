import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { PaymentMethodService } from './services/payment-method';

export declare class PaymentMethodProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    paymentMethods: Environment.Service<PaymentMethodService>;
  };
}
