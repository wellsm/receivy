import type { String } from '@ez4/schema';
import { type ContactPaymentMethodInput, PaymentProvider, type PixKeyType } from '@receivy/common';

/** How the owner pays this contact, as the form types it: the same shape as `PaymentMethodBody`, Pix only. */
export declare class ContactPaymentMethodBody {
  provider: PaymentProvider;
  kind: PixKeyType;
  value: String.Max<254>;
  label?: String.Max<120>;
}

/** A contact key is always Pix: whatever provider the body names, the stored key is a Pix key. */
export function contactPaymentMethodInput(body: ContactPaymentMethodBody): ContactPaymentMethodInput {
  return { provider: PaymentProvider.Pix, kind: body.kind, value: body.value, label: body.label };
}
