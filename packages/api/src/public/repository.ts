import { randomBytes } from "node:crypto";
import { HttpForbiddenError, HttpNotFoundError } from "@ez4/gateway";
import type { PublicChargeView, PublicLink } from "@receivy/common";
import type { DbClient } from "../database";
import { CHARGE_SELECT, findChargeForActor } from "../charges/repository";
import { assertPublicLinkSecretConfigured, issuePublicChargeToken, verifyPublicChargeToken } from "./capability";

const LINK_SELECT = { id: true, public_id: true, charge_id: true, token_version: true, expires_at: true,
  revoked_at: true, created_at: true, updated_at: true } as const;
const TTL_SECONDS = 90 * 24 * 60 * 60;
const sqlNull = null as unknown as string | undefined;

function response(row: { public_id: string; token_version: number; expires_at: string }, secret: string): PublicLink {
  return { token: issuePublicChargeToken({ publicId: row.public_id, version: row.token_version,
    expiresAtSeconds: Math.floor(new Date(row.expires_at).getTime() / 1000), secret }), expiresAt: row.expires_at };
}

export async function createOrRotatePublicLink(db: DbClient, creditorId: string, chargeId: string, secret: string,
  rotate = false, nowSeconds = Math.floor(Date.now() / 1000)): Promise<PublicLink> {
  assertPublicLinkSecretConfigured(secret);
  return db.transaction(async tx => {
    const { row, direction } = await findChargeForActor(tx, creditorId, chargeId, true);
    if (direction !== "receivable") throw new HttpForbiddenError();
    const existing = await tx.public_links.findOne({ select: LINK_SELECT, where: { charge_id: row.id }, lock: true });
    if (existing && !rotate && !existing.revoked_at && new Date(existing.expires_at).getTime() / 1000 > nowSeconds) {
      return response(existing, secret);
    }
    const expiresAt = new Date((nowSeconds + TTL_SECONDS) * 1000).toISOString();
    const now = new Date(nowSeconds * 1000).toISOString();
    if (existing) {
      const changed = await tx.public_links.updateOne({ select: { id: true }, where: { id: existing.id }, data: {
        token_version: existing.token_version + 1, expires_at: expiresAt, revoked_at: sqlNull, updated_at: now,
      } });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.public_links.findOne({ select: LINK_SELECT, where: { id: existing.id } });
      if (!updated) throw new HttpNotFoundError();
      return response(updated, secret);
    }
    const created = await tx.public_links.insertOne({ select: LINK_SELECT, data: { id: crypto.randomUUID(),
      public_id: randomBytes(16).toString("base64url"), charge: { id: row.id }, token_version: 1,
      expires_at: expiresAt, created_at: now, updated_at: now } });
    return response(created, secret);
  });
}

export async function revokePublicLink(db: DbClient, creditorId: string, chargeId: string): Promise<void> {
  await db.transaction(async tx => {
    const { row, direction } = await findChargeForActor(tx, creditorId, chargeId, true);
    if (direction !== "receivable") throw new HttpForbiddenError();
    const link = await tx.public_links.findOne({ select: LINK_SELECT, where: { charge_id: row.id }, lock: true });
    if (!link || link.revoked_at) return;
    await tx.public_links.updateOne({ select: { id: true }, where: { id: link.id },
      data: { revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  });
}

export async function getPublicCharge(db: DbClient, token: string, secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)): Promise<PublicChargeView> {
  const charge = await resolvePublicCharge(db, token, secret, nowSeconds);
  const user = await db.users.findOne({ select: { name: true }, where: { id: charge.creditor_id } });
  const firstName = user?.name?.trim().split(/\s+/)[0] || "Pessoa";
  return {
    creditorFirstName: firstName, description: charge.description,
    amount: { amountCents: charge.amount_cents, currency: charge.currency }, dueDate: charge.due_date, state: charge.state,
    pix: charge.pix_key_type_snapshot && charge.pix_key_snapshot ? { keyType: charge.pix_key_type_snapshot,
      key: charge.pix_key_snapshot, label: charge.pix_label_snapshot ?? "Pix" } : null,
    uploadsEnabled: charge.state === "pending" && !(await db.payment_proofs.count({ where: { charge_id: charge.id, state: "pending" } })),
  };
}

export async function resolvePublicCharge(db: DbClient, token: string, secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)) {
  assertPublicLinkSecretConfigured(secret);
  const publicId = token.split(".")[0];
  if (!publicId) throw new HttpNotFoundError();
  const link = await db.public_links.findOne({ select: LINK_SELECT, where: { public_id: publicId } });
  if (!link || link.revoked_at) throw new HttpNotFoundError();
  let capability: { publicId: string; expiresAtSeconds: number };
  try { capability = verifyPublicChargeToken(token, { version: link.token_version, nowSeconds, secret }); }
  catch { throw new HttpNotFoundError(); }
  const storedExpiry = Math.floor(new Date(link.expires_at).getTime() / 1000);
  if (capability.expiresAtSeconds !== storedExpiry || storedExpiry <= nowSeconds) throw new HttpNotFoundError();
  const charge = await db.charges.findOne({ select: CHARGE_SELECT, where: { id: link.charge_id } });
  if (!charge) throw new HttpNotFoundError();
  return charge;
}
