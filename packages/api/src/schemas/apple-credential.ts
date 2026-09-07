import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

/** Detached on local erasure. Never export this internal provider journal. */
export interface AppleCredentialSchema extends Database.Schema {
  id: String.UUID;
  user_id?: String.UUID;
  client_id: String.Max<320>;
  fingerprint: String.Max<100>;
  ciphertext?: String.Max<16384>;
  state: "active" | "pending" | "revoking" | "revoked" | "blocked";
  reason: String.Max<80>;
  attempts: number;
  available_at: String.DateTime;
  lease_until?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
