import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { HttpConflictError } from "@ez4/gateway";
import { Order } from "@ez4/database";
import type { DbClient } from "../database";
import { lockAccountReferences } from "../account/locking";

const sqlNull = null as unknown as undefined;
const STAGING_MS = 10 * 60_000, LEASE_MS = 60_000;
export type ProviderRevocation = "not_required" | "pending" | "manual_action_required" | "unknown";
export type AppleRevoke = (input: { token: string; clientId: string }) => Promise<"revoked" | "transient" | "configuration_error">;
export function appleEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded || "", "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("Apple credential encryption key is unavailable");
  return key;
}
export function appleKeyAvailable(encoded: string): boolean { try { appleEncryptionKey(encoded); return true; } catch { return false; } }
export function appleFingerprint(key: string, clientId: string, subject: string): string {
  return createHmac("sha256", Buffer.from(hkdfSync("sha256", appleEncryptionKey(key), "receivy-apple-v1", "subject-fingerprint", 32))).update(JSON.stringify([clientId, subject])).digest("hex");
}
export function encryptAppleToken(key: string, id: string, clientId: string, token: string): string {
  if (!token || token.length > 8000) throw new Error("Invalid Apple credential");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", appleEncryptionKey(key), nonce);
  cipher.setAAD(Buffer.from(JSON.stringify([id, clientId])));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptAppleToken(key: string, row: { id: string; client_id: string; ciphertext?: string }): string {
  const [version, nonce, tag, encrypted] = (row.ciphertext || "").split(".");
  if (version !== "v1" || !nonce || !tag || !encrypted) throw new Error("Apple credential is unreadable");
  const cipher = createDecipheriv("aes-256-gcm", appleEncryptionKey(key), Buffer.from(nonce, "base64url"));
  cipher.setAAD(Buffer.from(JSON.stringify([row.id, row.client_id]))); cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, "base64url")), cipher.final()]).toString("utf8");
}
async function lockFingerprint(db: DbClient, fingerprint: string) {
  await db.rawQuery("SELECT pg_advisory_xact_lock(hashtextextended(:fingerprint, 0))", { fingerprint: `apple:${fingerprint}` });
}

/** Journal remote issuance before local activation. Unknown-subject rows conservatively gate this client. */
export async function journalAppleCredential(db: DbClient, key: string, clientId: string, token: string, now = Date.now()): Promise<string> {
  const id = randomUUID(), stamp = new Date(now).toISOString();
  const ciphertext = encryptAppleToken(key, id, clientId, token);
  await db.transaction(async tx => {
    await lockAccountReferences(tx, "write");
    await tx.apple_credentials.insertOne({ data: { id, client_id: clientId, fingerprint: "unknown", ciphertext, state: "pending", reason: "exchange_staged", attempts: 0, available_at: new Date(now + STAGING_MS).toISOString(), created_at: stamp, updated_at: stamp } });
  });
  return id;
}
export async function bindAppleCredential(db: DbClient, key: string, id: string, subject: string): Promise<void> {
  await db.transaction(async tx => {
    await lockAccountReferences(tx, "write");
    const row = await tx.apple_credentials.findOne({ select: { client_id: true, state: true, attempts: true, reason: true }, where: { id }, lock: true });
    if (!row || row.state !== "pending" || row.attempts || row.reason !== "exchange_staged") throw new HttpConflictError();
    await tx.apple_credentials.updateOne({ where: { id }, data: { fingerprint: appleFingerprint(key, row.client_id, subject), updated_at: new Date().toISOString() } });
  });
}
/** Caller must hold the outer account barrier before user/identity locks. */
export async function claimAppleActivation(db: DbClient, id: string, now = Date.now()): Promise<void> {
  const candidate = await db.apple_credentials.findOne({ select: { fingerprint: true }, where: { id } });
  if (!candidate || candidate.fingerprint === "unknown") throw new HttpConflictError();
  await lockFingerprint(db, candidate.fingerprint);
  const row = await db.apple_credentials.findOne({ select: { fingerprint: true, client_id: true, state: true, reason: true, attempts: true, available_at: true }, where: { id }, lock: true });
  if (!row || row.state !== "pending" || row.reason !== "exchange_staged" || row.attempts || Date.parse(row.available_at) <= now) throw new HttpConflictError();
  const blocking = await db.apple_credentials.count({ where: { id: { not: id }, state: { isIn: ["pending", "revoking", "blocked"] }, OR: [{ fingerprint: row.fingerprint }, { fingerprint: "unknown", client_id: row.client_id }] } });
  if (blocking) throw new HttpConflictError("Apple cleanup is pending. Try again later.");
}
export async function activateAppleCredential(db: DbClient, id: string, userId: string): Promise<void> {
  await db.apple_credentials.updateOne({ where: { id }, data: { user: { id: userId }, state: "active", reason: "retained_for_account_deletion", updated_at: new Date().toISOString() } });
}
/** Called inside account erasure's exclusive barrier, before identity removal. */
export async function detachAppleCredentials(db: DbClient, userId: string, now: string): Promise<ProviderRevocation> {
  const count = await db.apple_credentials.count({ where: { user_id: userId } });
  const hasIdentity = !!await db.auth_identities.count({ where: { user_id: userId, provider: "apple" } });
  if (count) {
    await db.apple_credentials.updateMany({ where: { user_id: userId }, data: { ...{ user_id: sqlNull }, state: "pending", reason: "account_deleted", available_at: now, updated_at: now } });
    return "pending";
  }
  if (!hasIdentity) return "not_required";
  await db.apple_credentials.insertOne({ data: { id: randomUUID(), client_id: "legacy_unknown", fingerprint: "unknown", state: "blocked", reason: "blocked_missing_credential", attempts: 0, available_at: now, created_at: now, updated_at: now } });
  return "manual_action_required";
}
export async function drainAppleRevocations(db: DbClient, key: string, revoke: AppleRevoke, clock = Date.now) {
  const candidates = await db.apple_credentials.findMany({ select: { id: true, fingerprint: true }, where: { state: { isIn: ["pending", "revoking", "blocked"] }, reason: { not: "blocked_missing_credential" }, available_at: { lte: new Date(clock()).toISOString() } }, order: { available_at: Order.Asc }, take: 20 });
  let processed = 0, revoked = 0, blocked = 0;
  for (const candidate of candidates.records) {
    const claim = await db.transaction(async tx => {
      await lockAccountReferences(tx, "write"); await lockFingerprint(tx, candidate.fingerprint);
      const row = await tx.apple_credentials.findOne({ select: { id: true, client_id: true, fingerprint: true, ciphertext: true, state: true, reason: true, attempts: true, available_at: true, lease_until: true }, where: { id: candidate.id }, lock: true });
      const now = clock(), stamp = new Date(now).toISOString();
      if (!row || !["pending", "revoking", "blocked"].includes(row.state) || Date.parse(row.available_at) > now || (row.lease_until && Date.parse(row.lease_until) > now)) return;
      if (!row.ciphertext) { blocked++; return; }
      let token: string;
      try { token = decryptAppleToken(key, row); } catch {
        await tx.apple_credentials.updateOne({ where: { id: row.id }, data: { state: "blocked", reason: "encryption_key_unavailable", available_at: new Date(now + 3600_000).toISOString(), updated_at: stamp } }); blocked++; return;
      }
      const lease = new Date(now + LEASE_MS).toISOString(), attempts = Math.min(row.attempts + 1, 1_000_000);
      await tx.apple_credentials.updateOne({ where: { id: row.id }, data: { state: "revoking", lease_until: lease, available_at: lease, attempts, updated_at: stamp } });
      return { row, token, lease, attempts };
    });
    if (!claim) continue;
    processed++;
    let result: Awaited<ReturnType<AppleRevoke>>;
    try { result = await revoke({ token: claim.token, clientId: claim.row.client_id }); } catch { result = "transient"; }
    await db.transaction(async tx => {
      await lockAccountReferences(tx, "write"); await lockFingerprint(tx, claim.row.fingerprint);
      const row = await tx.apple_credentials.findOne({ select: { state: true, lease_until: true }, where: { id: claim.row.id }, lock: true });
      if (!row || row.state !== "revoking" || row.lease_until !== claim.lease) return;
      const now = clock(), stamp = new Date(now).toISOString();
      if (result === "revoked") {
        await tx.apple_credentials.updateOne({ where: { id: claim.row.id }, data: { state: "revoked", reason: "provider_confirmed", ciphertext: sqlNull, lease_until: sqlNull, updated_at: stamp } }); revoked++;
      } else {
        await tx.apple_credentials.updateOne({ where: { id: claim.row.id }, data: { state: result === "configuration_error" ? "blocked" : "pending", reason: result, lease_until: sqlNull, available_at: new Date(now + Math.min(24 * 3600_000, 60_000 * 2 ** Math.min(claim.attempts, 11))).toISOString(), updated_at: stamp } });
        if (result === "configuration_error") blocked++;
      }
    });
  }
  return { processed, revoked, blocked };
}
