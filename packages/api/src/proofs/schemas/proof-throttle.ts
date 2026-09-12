import type { Database } from '@ez4/database';
import type { String } from '@ez4/schema';

/** Sliding quota buckets for public uploads and lookups; the id is the scope, the row is the counter. */
export interface ProofThrottleSchema extends Database.Schema {
  id: String.Max<64>;
  attempts: number;
  expires_at: String.DateTime;
}
