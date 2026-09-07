import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface ExpenseSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  type: "one_time" | "installment";
  description: String.Max<500>;
  total_cents: number;
  currency: "BRL";
  installment_count: number;
  first_due_date: String.Date;
  payment_method_id?: String.UUID;
  idempotency_key: String.Max<200>;
  request_hash: String.Max<64>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
