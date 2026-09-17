import type { Http } from '@ez4/gateway';
import type { Integer, String } from '@ez4/schema';
import type {
  BillingCategory,
  BillingDueRule,
  BillingFrequency,
  BillingKind,
  BillingState,
  BillingRecurrence,
  Direction,
  EditScope,
  PendingChargesAction,
  PixKeyType,
  SplitMode,
  SplitPartKind
} from '@receivy/common';

// Keep the arms explicit: EZ4 reflection cannot extract intersections out of a union.
export declare class SplitBody {
  mode: SplitMode;
  parts: (
    | { kind: SplitPartKind.Owner; basisPoints?: number; shares?: Integer.Range<1, 1000> }
    | {
        kind: SplitPartKind.User;
        userId: String.UUID;
        notify?: boolean;
        amountCents?: number;
        basisPoints?: number;
        shares?: Integer.Range<1, 1000>;
      }
  )[];
}

export declare class PixBody {
  keyType: PixKeyType;
  key: String.Max<254>;
  label?: String.Max<120>;
}

export declare class ReminderBody {
  offsetDays: Integer.Range<-90, 90>;
  enabled: boolean;
}

export declare class BillingBody implements Http.JsonBody {
  recurrence: BillingRecurrence;
  frequency?: BillingFrequency;
  description?: String.Max<500>;
  totalCents: Integer.Min<1>;
  startDate: String.Date;
  endDate?: String.Date;
  dueRule?: BillingDueRule;
  timezone: String.Max<100>;
  paymentMethodId?: String.UUID;
  reminders?: ReminderBody[];
  /** Required on a conta a receber; a conta a pagar (type payable) has no participants. */
  split?: SplitBody;
  type?: Direction;
  payeeUserId?: String.UUID;
  pix?: PixBody;
  category?: BillingCategory;
  /** Registro: already received or paid; the owner alone, no participants, Pix or reminders. */
  kind?: BillingKind;
  /** Registro only; trimmed to 1–120 characters by the domain, which answers the pt-BR message. */
  counterpartLabel?: String.Max<200>;
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
  dueRule?: BillingDueRule;
  reminders?: ReminderBody[];
  state?: BillingState;
  pendingCharges?: PendingChargesAction;
  applyTo?: EditScope;
  category?: BillingCategory;
  kind?: BillingKind;
  counterpartLabel?: String.Max<200>;
}
