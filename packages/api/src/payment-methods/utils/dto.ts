import type { PaymentMethod, PaymentProvider, PixKeyType } from '@receivy/common';

export type PaymentMethodRow = {
  id: string;
  contact_id?: string | null;
  provider?: PaymentProvider;
  kind?: PixKeyType | null;
  value?: string;
  label: string;
  is_default: boolean;
  archived_at?: string | null;
  created_at: string;
};

/** A row the backfill has not reached yet has no provider: it must never reach a client half-read. */
export function paymentMethodOf(row: PaymentMethodRow): PaymentMethod {
  if (!row.provider || row.value === undefined) {
    throw new Error(`Payment method ${row.id} was not backfilled`);
  }

  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind ?? null,
    value: row.value,
    label: row.label,
    isDefault: row.is_default,
    contactId: row.contact_id ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at
  };
}
