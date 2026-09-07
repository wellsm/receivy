import { createHash } from "node:crypto";
import { HttpError } from "@ez4/gateway";
import type { DbClient } from "../database";

/** The pinned gateway drops trusted sourceIp. Never derive a quota identity from caller headers. */
export async function throttleProof(db: DbClient, capabilityOrUser: string, now = Date.now()) {
  for (const [scope, limit] of [["unknown-client", 120], [`capability:${capabilityOrUser}`, 12]] as const) {
    const id = createHash("sha256").update(scope).digest("hex");
    const rows = await db.rawQuery(`INSERT INTO proof_throttles (id, attempts, expires_at) VALUES (:id, 1, :expiry)
      ON CONFLICT (id) DO UPDATE SET attempts = CASE WHEN proof_throttles.expires_at <= :now THEN 1 ELSE proof_throttles.attempts + 1 END,
      expires_at = CASE WHEN proof_throttles.expires_at <= :now THEN :expiry ELSE proof_throttles.expires_at END RETURNING attempts`,
    { id, expiry: new Date(now + 600_000).toISOString(), now: new Date(now).toISOString() });
    if (Number(rows[0]?.["attempts"]) > limit) throw new HttpError(429, "Muitos envios. Aguarde alguns minutos.");
  }
}
