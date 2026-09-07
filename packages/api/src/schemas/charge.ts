import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface ChargeSchema extends Database.Schema {
  id: String.UUID;
  creditor_id: String.UUID;
  debtor_person_id: String.UUID;
  recipient_user_id?: String.UUID;
  recipient_name_snapshot: String.Max<120>;
  recipient_email_snapshot?: String.Max<254>;
  source: "expense" | "recurrence";
  source_id: String.UUID;
  source_occurrence_id?: String.UUID;
  description: String.Max<500>;
  amount_cents: number;
  currency: "BRL";
  due_date: String.Date;
  installment: number;
  installment_count: number;
  pix_key_type_snapshot?: "cpf" | "cnpj" | "email" | "phone" | "random";
  pix_key_snapshot?: String.Max<254>;
  pix_label_snapshot?: String.Max<120>;
  state: "pending" | "paid" | "cancelled";
  cancelled_at?: String.DateTime;
  paid_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
