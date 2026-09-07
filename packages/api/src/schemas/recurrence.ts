import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";

export interface RecurrenceSchema extends Database.Schema {
  id: String.UUID; owner_id: String.UUID; description: String.Max<500>; total_cents: number; currency: "BRL";
  frequency: "monthly" | "yearly"; day: number; month?: number; start_date: String.Date; end_date?: String.Date;
  timezone: String.Max<100>; payment_method_id?: String.UUID; state: "active" | "paused" | "ended";
  processed_through: String.Date; idempotency_key: String.Max<200>; request_hash: String.Max<64>;
  created_at: String.DateTime; updated_at: String.DateTime;
}
export interface RecurrenceAllocationSchema extends Database.Schema {
  id: String.UUID; recurrence_id: String.UUID; person_id?: String.UUID; kind: "owner" | "person";
  split_mode: "fixed" | "equal" | "percentage"; amount_cents: number; basis_points?: number; allocation_order: number;
}
export interface RecurrenceReminderSchema extends Database.Schema {
  id: String.UUID; recurrence_id: String.UUID; offset_days: number; channel: "auto"; enabled: boolean;
}
export interface RecurrenceOccurrenceSchema extends Database.Schema {
  id: String.UUID; recurrence_id: String.UUID; occurrence_date: String.Date; materialized_at: String.DateTime;
  reminders_json: String.Max<4000>; timezone: String.Max<100>;
}
