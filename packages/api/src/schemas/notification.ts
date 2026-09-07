import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";
export interface NotificationPreferenceSchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  email_enabled: boolean;
  push_enabled: boolean;
  reminder_offsets: String.Max<100>;
  updated_at: String.DateTime;
}
export interface DeviceTokenSchema extends Database.Schema {
  id: String.UUID;
  user_id: String.UUID;
  token: String.Max<300>;
  installation_id: String.Max<100>;
  platform: "ios" | "android";
  active: boolean;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
export interface NotificationDeliverySchema extends Database.Schema {
  id: String.UUID;
  event_id: String.UUID;
  charge_id: String.UUID;
  recipient_key: String.Max<300>;
  recipient_user_id?: String.UUID;
  device_id?: String.UUID;
  channel: "email" | "push";
  template: "initial" | "reminder";
  state:
    | "pending"
    | "sending"
    | "accepted"
    | "delivered"
    | "disabled"
    | "failed"
    | "uncertain"
    | "suppressed";
  render_inputs: String.Max<4000>;
  body_hash: String.Max<64>;
  idempotency_key: String.Max<200>;
  attempts: number;
  available_at: String.DateTime;
  lease_until?: String.DateTime;
  first_attempt_at?: String.DateTime;
  provider_id?: String.Max<200>;
  reason?: String.Max<80>;
  created_at: String.DateTime;
  updated_at: String.DateTime;
}
