import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface LoginCodeSchema extends Database.Schema {
  id: String.UUID;
  email: String.Email;
  code_hash: String.Max<128>;
  attempts: number;
  expires_at: String.DateTime;
  consumed_at?: String.DateTime;
  created_at: String.DateTime;
}
