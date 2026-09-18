import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { normalizePixKey, type PaymentMethodInput, type PixKeyType } from '@receivy/common';

export declare class PaymentMethodBody implements Http.JsonBody {
  pixKeyType: PixKeyType;
  pixKey: String.Max<254>;
  label?: String.Max<120>;
  contactId?: String.UUID;
}

export function paymentMethodInput(body: PaymentMethodBody): PaymentMethodInput {
  return { pixKeyType: body.pixKeyType, pixKey: body.pixKey, label: body.label, contactId: body.contactId };
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

/** The key as it is stored: normalized for its type, with a label of up to 120 characters ('Pix' when blank). */
export function normalizePaymentMethod(input: Pick<PaymentMethodInput, 'pixKeyType' | 'pixKey' | 'label'>): { key: string; label: string } {
  const key = normalizePixKey(input.pixKeyType, input.pixKey);
  const label = input.label?.normalize('NFC').trim() || 'Pix';

  if (label.length > 120) {
    throw new RangeError('Rótulo inválido.');
  }

  return { key, label };
}
