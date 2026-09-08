import { randomBytes } from 'node:crypto';
import { HttpConflictError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { PublicChargeView, PublicLink } from '@receivy/common';
import { CHARGE_SELECT, findChargeForActor } from '../charges/repository';
import type { DbClient } from '../database';
import { assertPublicLinkSecretConfigured, issuePublicChargeToken, verifyPublicChargeToken } from './capability';

const LINK_SELECT = {
  id: true,
  public_id: true,
  charge_id: true,
  token_version: true,
  expires_at: true,
  revoked_at: true,
  created_at: true,
  updated_at: true
} as const;
const TTL_SECONDS = 90 * 24 * 60 * 60;
const sqlNull = null as unknown as string | undefined;

function response(row: { public_id: string; token_version: number; expires_at: string }, secret: string): PublicLink {
  return {
    token: issuePublicChargeToken({
      publicId: row.public_id,
      version: row.token_version,
      expiresAtSeconds: Math.floor(new Date(row.expires_at).getTime() / 1000),
      secret
    }),
    expiresAt: row.expires_at
  };
}

export async function createOrRotatePublicLink(
  db: DbClient,
  creditorId: string,
  chargeId: string,
  secret: string,
  rotate = false,
  nowSeconds = Math.floor(Date.now() / 1000),
  paymentMethodId?: string
): Promise<PublicLink> {
  assertPublicLinkSecretConfigured(secret);
  return db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(tx, creditorId, chargeId, true);
    if (direction !== 'receivable') throw new HttpForbiddenError();
    if (row.state !== 'pending') throw new HttpConflictError('Charge is closed.');
    const existing = await tx.public_links.findOne({ select: LINK_SELECT, where: { charge_id: row.id }, lock: true });
    if (!row.pix_key_snapshot || !row.pix_key_type_snapshot) {
      if (existing || !paymentMethodId) throw new HttpConflictError('Pix required before first publication.');
      const method = await tx.payment_methods.findOne({
        select: { pix_key: true, pix_key_type: true, label: true },
        where: { id: paymentMethodId, owner_id: creditorId, archived_at: { isNull: true } },
        lock: true
      });
      if (!method) throw new HttpNotFoundError();
      const stamp = new Date(nowSeconds * 1000).toISOString();
      await tx.charges.updateOne({
        where: { id: row.id },
        data: {
          pix_key_snapshot: method.pix_key,
          pix_key_type_snapshot: method.pix_key_type,
          pix_label_snapshot: method.label,
          updated_at: stamp
        }
      });
      await tx.activity_events.insertOne({
        data: {
          id: crypto.randomUUID(),
          actor_user: { id: creditorId },
          subject_user: { id: creditorId },
          type: 'charge.pix_published',
          aggregate_type: 'charge',
          aggregate_id: row.id,
          payload: '{}',
          created_at: stamp
        }
      });
      const {
        records: [initial]
      } = await tx.outbox_events.findMany({
        select: { id: true, payload: true },
        where: { aggregate_id: row.id, type: 'charge.created', state: 'delivered' },
        take: 1
      });
      if (initial && (await tx.notification_deliveries.count({ where: { event_id: initial.id, reason: 'pix_required', attempts: 0 } }))) {
        await tx.outbox_events.updateOne({
          where: { id: initial.id },
          data: {
            state: 'pending',
            available_at: stamp,
            updated_at: stamp,
            payload: JSON.stringify({ ...JSON.parse(initial.payload), notificationResumed: true })
          }
        });
      }
    } else if (paymentMethodId) {
      const method = await tx.payment_methods.findOne({
        select: { pix_key: true, pix_key_type: true },
        where: { id: paymentMethodId, owner_id: creditorId, archived_at: { isNull: true } }
      });
      if (!method) throw new HttpNotFoundError();
      if (method.pix_key !== row.pix_key_snapshot || method.pix_key_type !== row.pix_key_type_snapshot)
        throw new HttpConflictError('Published Pix snapshot is immutable.');
    }
    if (existing && !rotate && !existing.revoked_at && new Date(existing.expires_at).getTime() / 1000 > nowSeconds) {
      return response(existing, secret);
    }
    const expiresAt = new Date((nowSeconds + TTL_SECONDS) * 1000).toISOString();
    const now = new Date(nowSeconds * 1000).toISOString();
    if (existing) {
      const changed = await tx.public_links.updateOne({
        select: { id: true },
        where: { id: existing.id },
        data: {
          token_version: existing.token_version + 1,
          expires_at: expiresAt,
          revoked_at: sqlNull,
          updated_at: now
        }
      });
      if (!changed) throw new HttpNotFoundError();
      const updated = await tx.public_links.findOne({ select: LINK_SELECT, where: { id: existing.id } });
      if (!updated) throw new HttpNotFoundError();
      return response(updated, secret);
    }
    const created = await tx.public_links.insertOne({
      select: LINK_SELECT,
      data: {
        id: crypto.randomUUID(),
        public_id: randomBytes(16).toString('base64url'),
        charge: { id: row.id },
        token_version: 1,
        expires_at: expiresAt,
        created_at: now,
        updated_at: now
      }
    });
    return response(created, secret);
  });
}

export async function revokePublicLink(db: DbClient, creditorId: string, chargeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(tx, creditorId, chargeId, true);
    if (direction !== 'receivable') throw new HttpForbiddenError();
    const link = await tx.public_links.findOne({ select: LINK_SELECT, where: { charge_id: row.id }, lock: true });
    if (!link || link.revoked_at) return;
    await tx.public_links.updateOne({
      select: { id: true },
      where: { id: link.id },
      data: { revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    });
  });
}

export async function getPublicCharge(
  db: DbClient,
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<PublicChargeView> {
  const charge = await resolvePublicCharge(db, token, secret, nowSeconds);
  const user = await db.users.findOne({ select: { name: true }, where: { id: charge.creditor_id } });
  const firstName = user?.name?.trim().split(/\s+/)[0] || 'Pessoa';
  return {
    creditorFirstName: firstName,
    description: charge.description,
    amount: { amountCents: charge.amount_cents, currency: charge.currency },
    dueDate: charge.due_date,
    state: charge.state,
    pix:
      charge.pix_key_type_snapshot && charge.pix_key_snapshot
        ? { keyType: charge.pix_key_type_snapshot, key: charge.pix_key_snapshot, label: charge.pix_label_snapshot ?? 'Pix' }
        : null,
    uploadsEnabled: charge.state === 'pending' && !(await db.payment_proofs.count({ where: { charge_id: charge.id, state: 'pending' } }))
  };
}

export async function resolvePublicCharge(db: DbClient, token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  assertPublicLinkSecretConfigured(secret);
  const publicId = token.split('.')[0];
  if (!publicId) throw new HttpNotFoundError();
  const link = await db.public_links.findOne({ select: LINK_SELECT, where: { public_id: publicId } });
  if (!link || link.revoked_at) throw new HttpNotFoundError();
  let capability: { publicId: string; expiresAtSeconds: number };
  try {
    capability = verifyPublicChargeToken(token, { version: link.token_version, nowSeconds, secret });
  } catch {
    throw new HttpNotFoundError();
  }
  const storedExpiry = Math.floor(new Date(link.expires_at).getTime() / 1000);
  if (capability.expiresAtSeconds !== storedExpiry || storedExpiry <= nowSeconds) throw new HttpNotFoundError();
  const charge = await db.charges.findOne({ select: CHARGE_SELECT, where: { id: link.charge_id } });
  if (!charge) throw new HttpNotFoundError();
  return charge;
}
