import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface ExpenseAllocationSchema extends Database.Schema {
  id: String.UUID;
  expense_id: String.UUID;
  person_id?: String.UUID;
  kind: "owner" | "person";
  split_mode: "fixed" | "equal" | "percentage";
  basis_points?: number;
  amount_cents: number;
  allocation_order: number;
  created_at: String.DateTime;
}
