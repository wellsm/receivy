import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PaymentMethodInput, PixKeyType } from '@receivy/common';

export declare class PaymentMethodBody implements Http.JsonBody {
  pixKeyType: PixKeyType;
  pixKey: String.Max<254>;
  label?: String.Max<120>;
}

export function paymentMethodInput(body: PaymentMethodBody): PaymentMethodInput {
  return { pixKeyType: body.pixKeyType, pixKey: body.pixKey, label: body.label };
}

export async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HttpBadRequestError(error.message);
    }

    throw error;
  }
}
