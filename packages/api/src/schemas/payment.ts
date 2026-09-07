import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface PaymentSchema extends Database.Schema {
  id: String.UUID;
  charge_id: String.UUID;
  proof_id?: String.UUID;
  amount_cents: number;
  currency: "BRL";
  method: "pix" | "cash" | "transfer" | "other";
  registered_by_id: String.UUID;
  paid_at: String.DateTime;
  created_at: String.DateTime;
}
