import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface PersonContactSchema extends Database.Schema {
  id: String.UUID;
  person_id: String.UUID;
  type: "email" | "phone";
  value: String.Max<254>;
  normalized_value: String.Max<254>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
