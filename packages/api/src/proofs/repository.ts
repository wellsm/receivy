import { createHash } from "node:crypto";
import { HttpConflictError, HttpForbiddenError, HttpNotFoundError, HttpUnprocessableEntityError } from "@ez4/gateway";
import type { ProofDetail, ProofUploadInput, ProofUploadIntent } from "@receivy/common";
import type { DbClient } from "../database";
import { CHARGE_SELECT, findChargeForActor, type ChargeRow } from "../charges/repository";
import { resolvePublicCharge } from "../public/repository";
import { proofEvent } from "./events";
import { MAX_PROOF_BYTES, validateProof } from "./validation";
import type { ProofStorage } from "./storage";

export type ProofActor = { userId: string } | { token: string; secret: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const actorHash = (actor: ProofActor) => hash("userId" in actor ? `user:${actor.userId}` : `public:${actor.token}`);
const userId = (actor: ProofActor) => "userId" in actor ? actor.userId : undefined;
const SELECT = { id: true, charge_id: true, sender_user_id: true, object_key: true, original_name: true, mime: true,
  size: true, sha256: true, state: true, reason: true, closure_reason: true, reviewed_at: true, created_at: true } as const;
const INTENT = { id: true, charge_id: true, sender_user_id: true, actor_hash: true, object_key: true, original_name: true,
  mime: true, size: true, state: true, expires_at: true } as const;

async function authorize(db: DbClient, id: string, actor: ProofActor, lock = false): Promise<ChargeRow> {
  if ("userId" in actor) return (await findChargeForActor(db, actor.userId, id, lock)).row;
  const row = await db.charges.findOne({ select: CHARGE_SELECT, where: { id }, ...(lock ? { lock: true } : {}) });
  if (!row || (await resolvePublicCharge(db, actor.token, actor.secret)).id !== id) throw new HttpNotFoundError();
  return row;
}
function pending(row: ChargeRow) { if (row.state !== "pending") throw new HttpConflictError("A cobrança já foi encerrada."); }
function dto(row: { id: string; charge_id: string; original_name: string; mime: ProofDetail["mime"]; size: number;
  state: ProofDetail["state"]; reason?: string; closure_reason?: "paid" | "cancelled"; reviewed_at?: string; created_at: string }): ProofDetail {
  return { id: row.id, chargeId: row.charge_id, originalName: row.original_name, mime: row.mime, size: row.size,
    state: row.state, reason: row.reason ?? null, closureReason: row.closure_reason ?? null,
    reviewedAt: row.reviewed_at ?? null, createdAt: row.created_at };
}
export async function createUploadIntent(db: DbClient, storage: ProofStorage, id: string, actor: ProofActor,
  input: ProofUploadInput): Promise<ProofUploadIntent> {
  if (!["image/jpeg", "image/png", "application/pdf"].includes(input.mime) || !Number.isSafeInteger(input.size)
    || input.size <= 0 || input.size > MAX_PROOF_BYTES || !input.filename.trim() || input.filename.length > 200
    || /[\x00-\x1f\x7f]/.test(input.filename)) throw new HttpUnprocessableEntityError("Envie JPG, PNG ou PDF de até 10 MB.");
  const now = new Date().toISOString(); const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const intentId = crypto.randomUUID(); const key = `temporary/${crypto.randomUUID()}/${intentId}`;
  // Signing is external I/O and must not hold the financial row lock.
  await authorize(db, id, actor);
  const uploadUrl = await storage.uploadUrl(key, input.mime, input.size);
  await db.transaction(async tx => {
    pending(await authorize(tx, id, actor, true));
    await tx.upload_intents.updateMany({ where: { charge_id: id, state: "pending", expires_at: { lte: now } }, data: { state: "expired" } });
    if (await tx.upload_intents.count({ where: { charge_id: id, state: "pending" } })
      || await tx.payment_proofs.count({ where: { charge_id: id, state: "pending" } })) throw new HttpConflictError("Já existe um envio em andamento ou comprovante em revisão.");
    await tx.upload_intents.insertOne({ data: { id: intentId, charge: { id }, ...(userId(actor) ? { sender_user: { id: userId(actor)! } } : {}),
      actor_hash: actorHash(actor), object_key: key, original_name: input.filename.split(/[\\/]/).at(-1)!, mime: input.mime,
      size: input.size, state: "pending", expires_at: expiresAt, created_at: now } });
  });
  return { id: intentId, uploadUrl, expiresAt };
}
export async function finalizeProof(db: DbClient, storage: ProofStorage, id: string, actor: ProofActor, intentId: string): Promise<ProofDetail> {
  pending(await authorize(db, id, actor));
  const intent = await db.upload_intents.findOne({ select: INTENT, where: { id: intentId, charge_id: id, actor_hash: actorHash(actor) } });
  if (!intent) throw new HttpNotFoundError();
  if (intent.state !== "pending" || Date.parse(intent.expires_at) <= Date.now()) throw new HttpConflictError("O envio expirou ou já foi finalizado.");
  let bytes: Buffer; let validated: ReturnType<typeof validateProof>;
  try {
    bytes = await storage.read(intent.object_key); validated = validateProof(bytes, intent.mime);
    if (validated.size !== intent.size) throw new HttpUnprocessableEntityError("O tamanho do arquivo não corresponde ao envio autorizado.");
  } catch (failure) {
    if (failure instanceof HttpUnprocessableEntityError) {
      // A definitive file failure releases only this actor's still-pending intent.
      // Network/storage errors retain it for safe retries; concurrent committed proofs stay intact.
      await db.transaction(async tx => {
        await authorize(tx, id, actor, true);
        await tx.upload_intents.updateMany({ where: { id: intentId, charge_id: id, actor_hash: actorHash(actor), state: "pending" }, data: { state: "expired" } });
      });
      await storage.delete(intent.object_key).catch(() => undefined);
    }
    throw failure;
  }
  const proofId = crypto.randomUUID(); const finalKey = `proofs/${id}/${proofId}`;
  // Write exactly the bounded, validated bytes. Never copy a still-uploadable source object.
  await storage.write(finalKey, bytes, validated.mime);
  let committed = false;
  try {
    const proof = await db.transaction(async tx => {
      const row = await authorize(tx, id, actor, true); pending(row);
      const current = await tx.upload_intents.findOne({ select: INTENT, where: { id: intentId, actor_hash: actorHash(actor) } });
      if (!current || current.state !== "pending" || Date.parse(current.expires_at) <= Date.now()) throw new HttpConflictError("O envio expirou ou já foi finalizado.");
      if (await tx.payment_proofs.count({ where: { charge_id: id, state: "pending" } })) throw new HttpConflictError();
      const now = new Date().toISOString();
      const inserted = await tx.payment_proofs.insertOne({ select: SELECT, data: { id: proofId, charge: { id },
        ...(intent.sender_user_id ? { sender_user: { id: intent.sender_user_id } } : {}), object_key: finalKey,
        original_name: intent.original_name, mime: validated.mime, size: validated.size, sha256: validated.sha256, state: "pending", created_at: now } });
      await tx.upload_intents.updateOne({ where: { id: intentId }, data: { state: "finalized", proof_id: proofId } });
      await proofEvent(tx, row, "proof.submitted", now, userId(actor), proofId);
      return dto(inserted);
    });
    committed = true;
    await storage.delete(intent.object_key).catch(() => undefined);
    return proof;
  } finally {
    if (!committed) {
      // Lost commit acknowledgement is not proof of rollback. Keep potentially committed bytes.
      const exists = await db.payment_proofs.findOne({ select: { id: true }, where: { id: proofId } }).catch(() => ({ id: proofId }));
      if (!exists) await storage.delete(finalKey).catch(() => undefined);
    }
  }
}
export async function publicProofStatus(db: DbClient, token: string, secret: string, intentId: string) {
  const charge = await resolvePublicCharge(db, token, secret);
  const intent = await db.upload_intents.findOne({ select: { proof_id: true }, where: { id: intentId, charge_id: charge.id, actor_hash: actorHash({ token, secret }) } });
  if (!intent?.proof_id) throw new HttpNotFoundError();
  const proof = await db.payment_proofs.findOne({ select: { state: true, reason: true, closure_reason: true }, where: { id: intent.proof_id } });
  if (!proof) throw new HttpNotFoundError();
  return { state: proof.state, reason: proof.reason ?? null, closureReason: proof.closure_reason ?? null };
}
export async function listProofs(db: DbClient, id: string, actorId: string): Promise<ProofDetail[]> {
  const { direction } = await findChargeForActor(db, actorId, id);
  const result = await db.payment_proofs.findMany({ select: SELECT, where: { charge_id: id,
    ...(direction === "payable" ? { sender_user_id: actorId } : {}) } });
  return result.records.map(dto);
}
export async function downloadProof(db: DbClient, storage: ProofStorage, id: string, actorId: string, proofId: string) {
  const { direction } = await findChargeForActor(db, actorId, id);
  const proof = await db.payment_proofs.findOne({ select: SELECT, where: { id: proofId, charge_id: id,
    ...(direction === "payable" ? { sender_user_id: actorId } : {}) } });
  if (!proof) throw new HttpNotFoundError();
  return { url: await storage.downloadUrl(proof.object_key, proof.mime), expiresIn: 60 };
}
export async function reviewProof(db: DbClient, id: string, actorId: string, proofId: string,
  input: { decision: "accepted" | "rejected"; reason?: string }): Promise<ProofDetail> {
  if (!["accepted", "rejected"].includes(input.decision) || (input.reason?.length ?? 0) > 500) throw new HttpUnprocessableEntityError();
  return db.transaction(async tx => {
    const { row, direction } = await findChargeForActor(tx, actorId, id, true);
    if (direction !== "receivable") throw new HttpForbiddenError(); pending(row);
    const proof = await tx.payment_proofs.findOne({ select: SELECT, where: { id: proofId, charge_id: id } });
    if (!proof) throw new HttpNotFoundError(); if (proof.state !== "pending") throw new HttpConflictError("O comprovante já foi revisado.");
    const now = new Date().toISOString();
    if (input.decision === "accepted") {
      await tx.payments.insertOne({ data: { id: crypto.randomUUID(), charge: { id }, proof: { id: proofId }, amount_cents: row.amount_cents,
        currency: row.currency, method: "pix", registered_by: { id: actorId }, paid_at: now, created_at: now } });
      await tx.charges.updateOne({ where: { id }, data: { state: "paid", paid_at: now, updated_at: now } });
      await tx.upload_intents.updateMany({ where: { charge_id: id, state: "pending" }, data: { state: "expired" } });
      await proofEvent(tx, row, "charge.paid", now, actorId, proofId);
    }
    await tx.payment_proofs.updateOne({ where: { id: proofId }, data: { state: input.decision,
      reviewer: { id: actorId }, reviewed_at: now, ...(input.reason ? { reason: input.reason.trim() } : {}) } });
    await proofEvent(tx, row, `proof.${input.decision}`, now, actorId, proofId);
    const updated = await tx.payment_proofs.findOne({ select: SELECT, where: { id: proofId } });
    if (!updated) throw new HttpNotFoundError(); return dto(updated);
  });
}
