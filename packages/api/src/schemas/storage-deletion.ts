import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";
export interface StorageDeletionSchema extends Database.Schema {
  id: String.UUID;
  object_key: String.Max<300>;
  charge_id: String.UUID;
  purpose: "orphan" | "temporary" | "account";
  state: "pending" | "deleting" | "deleted" | "blocked";
  attempts: number;
  available_at: String.DateTime;
  lease_until?: String.DateTime;
  reason?: String.Max<80>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
export interface StorageCleanupCursorSchema extends Database.Schema {
  id: String.Max<40>;
  cursor?: String.Max<4000>;
  updated_at: String.DateTime;
}
