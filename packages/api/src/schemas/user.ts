import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface UserSchema extends Database.Schema {
  id: String.UUID;
  email: String.Email;
  name?: String.Max<120>;
  avatar_url?: String.Max<512>;
  locale: "pt-BR";
  timezone: String.Max<64>;
  country: "BR";
  currency: "BRL";
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
