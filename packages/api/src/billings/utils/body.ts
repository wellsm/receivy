import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';

// Keep the arms explicit: EZ4 reflection cannot extract intersections out of a union.
export declare class SplitBody {
  mode: 'fixed' | 'equal' | 'percentage' | 'shares';
  parts: (
    | { kind: 'owner'; basisPoints?: number; shares?: Integer.Range<1, 1000> }
    | { kind: 'user'; userId: String.UUID; amountCents?: number; basisPoints?: number; shares?: Integer.Range<1, 1000> }
  )[];
}

export declare class PixBody {
  keyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  key: String.Max<254>;
  label?: String.Max<120>;
}

export declare class ReminderBody {
  offsetDays: Integer.Range<-90, 90>;
  enabled: boolean;
}

export declare class BillingBody implements Http.JsonBody {
  type: 'once' | 'until' | 'indefinite';
  frequency?: 'monthly' | 'yearly';
  description?: String.Max<500>;
  totalCents: Integer.Min<1>;
  startDate: String.Date;
  endDate?: String.Date;
  timezone: String.Max<100>;
  paymentMethodId?: String.UUID;
  reminders?: ReminderBody[];
  /** Required on a conta a receber; a conta a pagar (direction 'payable') has no participants. */
  split?: SplitBody;
  direction?: 'receivable' | 'payable';
  payeeUserId?: String.UUID;
  pix?: PixBody;
  category?: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
}

export declare class PatchBody implements Http.JsonBody {
  description?: String.Max<500>;
  totalCents?: Integer.Min<1>;
  split?: SplitBody;
  paymentMethodId?: String.UUID;
  clearPaymentMethod?: boolean;
  pix?: PixBody;
  clearPix?: boolean;
  payeeUserId?: String.UUID;
  clearPayee?: boolean;
  startDate?: String.Date;
  reminders?: ReminderBody[];
  state?: 'active' | 'paused' | 'ended';
  category?: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
}
