import type { String } from '@ez4/schema';
import type { PixKeyType } from '@receivy/common';

/** How the owner pays this contact, as the form types it; `type` is implicit ('pix') until a second kind exists. */
export declare class ContactPaymentMethodBody {
  pixKeyType: PixKeyType;
  pixKey: String.Max<254>;
  label?: String.Max<120>;
}
