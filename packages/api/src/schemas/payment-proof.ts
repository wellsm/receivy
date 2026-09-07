import type { Database } from "@ez4/database";
import type { String } from "@ez4/schema";
export interface PaymentProofSchema extends Database.Schema {
  id: String.UUID; charge_id: String.UUID; sender_user_id?: String.UUID;
  object_key: String.Max<300>; original_name: String.Max<200>; mime: "image/jpeg" | "image/png" | "application/pdf";
  size: number; sha256: String.Max<64>; state: "pending" | "accepted" | "rejected";
  reviewer_id?: String.UUID; reason?: String.Max<500>; closure_reason?: "paid" | "cancelled";
  reviewed_at?: String.DateTime; created_at: String.DateTime;
}
export interface UploadIntentSchema extends Database.Schema {
  id: String.UUID; charge_id: String.UUID; sender_user_id?: String.UUID; actor_hash: String.Max<64>;
  object_key: String.Max<300>; original_name: String.Max<200>; mime: "image/jpeg" | "image/png" | "application/pdf";
  size: number; state: "pending" | "finalized" | "expired"; proof_id?: String.UUID;
  expires_at: String.DateTime; created_at: String.DateTime;
}
export interface ProofThrottleSchema extends Database.Schema {
  id: String.Max<64>; attempts: number; expires_at: String.DateTime;
}
