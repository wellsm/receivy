import type { PaymentMethod, PixKeyType } from '@receivy/common';

export type PaymentMethodRow = {
  id: string;
  contact_id?: string | null;
  pix_key_type: PixKeyType;
  pix_key: string;
  label: string;
  is_default: boolean;
  archived_at?: string | null;
  created_at: string;
};

export function paymentMethodOf(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    type: 'pix',
    pixKeyType: row.pix_key_type,
    pixKey: row.pix_key,
    label: row.label,
    isDefault: row.is_default,
    contactId: row.contact_id ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at
  };
}
