import type { Http } from '@ez4/gateway';
import { HttpBadRequestError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { normalizeHandle, normalizePixKey, type PaymentMethodInput, PaymentProvider, type PixKeyType } from '@receivy/common';

export declare class PaymentMethodBody implements Http.JsonBody {
  provider: PaymentProvider;
  /** Required when `provider` is `pix`; ignored otherwise. */
  kind?: PixKeyType;
  value: String.Max<254>;
  label?: String.Max<120>;
  contactId?: String.UUID;
}

export function paymentMethodInput(body: PaymentMethodBody): PaymentMethodInput {
  if (body.provider === PaymentProvider.InfinitePay) {
    return { provider: PaymentProvider.InfinitePay, value: body.value, label: body.label };
  }

  // A missing kind is caught by `normalizePixKey`, which refuses an unknown type.
  return { provider: PaymentProvider.Pix, kind: body.kind as PixKeyType, value: body.value, label: body.label, contactId: body.contactId };
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

export type NormalizedPaymentMethod = { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string };

/** The method as it is stored: the value canonical for its provider, a label of up to 120 characters (the provider's name when blank). */
export function normalizePaymentMethod(input: PaymentMethodInput): NormalizedPaymentMethod {
  const infinitePay = input.provider === PaymentProvider.InfinitePay;
  const value = infinitePay ? normalizeHandle(input.value) : normalizePixKey(input.kind, input.value);
  const label = input.label?.normalize('NFC').trim() || (infinitePay ? 'InfinitePay' : 'Pix');

  if (label.length > 120) {
    throw new RangeError('Rótulo inválido.');
  }

  return { provider: input.provider, kind: infinitePay ? null : input.kind, value, label };
}
