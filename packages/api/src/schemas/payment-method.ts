import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface PaymentMethodSchema extends Database.Schema {
  id: String.UUID;
  owner_id: String.UUID;
  type: "pix";
  pix_key_type: "cpf" | "cnpj" | "email" | "phone" | "random";
  pix_key: String.Max<254>;
  label: String.Max<120>;
  is_default: boolean;
  archived_at?: String.DateTime;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
