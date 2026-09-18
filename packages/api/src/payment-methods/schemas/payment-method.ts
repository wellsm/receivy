import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { PaymentProvider, PixKeyType } from '@receivy/common';

export interface PaymentMethodSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  /** Block 9: a key the owner keeps about a contact ("how I pay this person"); null is the owner's own key. */
  contact_id?: String.UUID;
  /** @deprecated D3 drops it: provider says the same. Nullable while the backfill runs. */
  type?: 'pix';
  /** @deprecated D3 drops it: read kind. */
  pix_key_type?: PixKeyType;
  /** @deprecated D3 drops it: read value. */
  pix_key?: String.Max<254>;
  /** Nullable until the backfill fills it; every reader treats a missing provider as an unbackfilled row. */
  provider?: PaymentProvider;
  /** The Pix key type; absent on any other provider. */
  kind?: PixKeyType;
  /** The canonical Pix key, or the InfiniteTag without `$`. */
  value?: String.Max<254>;
  label: String.Max<120>;
  is_default: boolean;
  archived_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
