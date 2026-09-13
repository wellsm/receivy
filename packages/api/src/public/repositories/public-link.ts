import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { ChargePayer, ChargeState, Direction, type PublicChargeView, type PublicLink } from '@receivy/common';
import { ChargeClosedError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { type NoticeContext, NoticeTemplate, notifyCharge } from '../../notifications/services/send';
import { PixRequiredError, PixSnapshotLockedError } from '../errors';
import { assertPublicLinkSecretConfigured, PublicTokenPurpose, verifyPublicChargeToken } from '../services/capability';
import { ensurePublicLink, linkToken } from '../services/links';

function response(row: ChargeRepository.Row, secret: string): PublicLink {
  if (!row.public_id || !row.link_expires_at) {
    throw new Error('Charge has no public link.');
  }

  return {
    token: linkToken({ public_id: row.public_id, link_expires_at: row.link_expires_at, link_version: row.link_version }, secret),
    expiresAt: row.link_expires_at
  };
}

export namespace PublicLinkRepository {
  /**
   * Issues (or reuses) the public payment link of a charge. Publishing a Pix key on a charge created
   * without one happens here too, and sends the initial notice that had nothing to say until now.
   */
  export async function createOrRotate(
    db: DbClient,
    creditorId: string,
    chargeId: string,
    secret: string,
    rotate = false,
    nowSeconds = Math.floor(Date.now() / 1000),
    paymentMethodId?: string,
    notice?: NoticeContext
  ): Promise<PublicLink> {
    assertPublicLinkSecretConfigured(secret);

    const { link, announce } = await db.transaction(async (tx) => {
      const { row, direction } = await ChargeRepository.findForActor(tx, creditorId, chargeId, true);

      // A conta a pagar never gets a public link: the owner pays with the key they typed.
      if (direction !== Direction.Receivable || ChargeRepository.payer(row) === ChargePayer.Owner) throw new HttpForbiddenError();
      if (row.state !== ChargeState.Pending) throw new ChargeClosedError();

      let current = row;
      let published = false;

      if (!row.pix_key_snapshot || !row.pix_key_type_snapshot) {
        if (row.public_id || !paymentMethodId) throw new PixRequiredError();
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
        await EventRepository.record(tx, {
          type: 'charge.pix_published',
          eventableType: EventableType.Charge,
          eventableId: row.id,
          actorId: creditorId,
          at: stamp
        });
        current = (await tx.charges.findOne({ select: ChargeRepository.SELECT, where: { id: row.id } }))!;
        // The creation notice was skipped for lack of a key; it goes out once the link exists.
        published = !(await EventRepository.list(tx, row.id, 'notice.sent')).some(
          (event) => event.payload['template'] === NoticeTemplate.Initial
        );
      } else if (paymentMethodId) {
        const method = await tx.payment_methods.findOne({
          select: { pix_key: true, pix_key_type: true },
          where: { id: paymentMethodId, owner_id: creditorId, archived_at: { isNull: true } }
        });
        if (!method) throw new HttpNotFoundError();
        if (method.pix_key !== row.pix_key_snapshot || method.pix_key_type !== row.pix_key_type_snapshot)
          throw new PixSnapshotLockedError();
      }

      const linked = await ensurePublicLink(tx, current, nowSeconds, rotate);

      return { link: response(linked, secret), announce: published };
    });

    if (announce && notice) {
      await notifyCharge(db, notice, chargeId, NoticeTemplate.Initial, nowSeconds * 1000);
    }

    return link;
  }

  export async function revoke(db: DbClient, creditorId: string, chargeId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const { row, direction } = await ChargeRepository.findForActor(tx, creditorId, chargeId, true);
      if (direction !== Direction.Receivable || ChargeRepository.payer(row) === ChargePayer.Owner) throw new HttpForbiddenError();
      if (!row.public_id || row.link_revoked_at) return;
      const stamp = new Date().toISOString();
      await tx.charges.updateOne({ where: { id: row.id }, data: { link_revoked_at: stamp, updated_at: stamp } });
    });
  }

  export async function getCharge(
    db: DbClient,
    token: string,
    secret: string,
    nowSeconds = Math.floor(Date.now() / 1000)
  ): Promise<PublicChargeView> {
    return chargeView(db, await resolveCharge(db, token, secret, nowSeconds));
  }

  export async function chargeView(db: DbClient, charge: ChargeRepository.Row): Promise<PublicChargeView> {
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
      uploadsEnabled: charge.state === ChargeState.Pending && charge.proof_state !== StoredProofState.Pending
    };
  }

  /** The charge behind a public token, or 404 for anything forged, rotated, revoked or expired. */
  export async function resolveCharge(
    db: DbClient,
    token: string,
    secret: string,
    nowSeconds = Math.floor(Date.now() / 1000)
  ): Promise<ChargeRepository.Row> {
    assertPublicLinkSecretConfigured(secret);
    const publicId = token.split('.')[0];
    if (!publicId) throw new HttpNotFoundError();
    const charge = await db.charges.findOne({ select: ChargeRepository.SELECT, where: { public_id: publicId } });
    if (!charge?.link_expires_at || charge.link_revoked_at) throw new HttpNotFoundError();
    let capability: { publicId: string; expiresAtSeconds: number };
    try {
      capability = verifyPublicChargeToken(token, {
        version: charge.link_version ?? 1,
        nowSeconds,
        secret,
        purpose: PublicTokenPurpose.Charge
      });
    } catch {
      throw new HttpNotFoundError();
    }
    const storedExpiry = Math.floor(Date.parse(charge.link_expires_at) / 1000);
    if (capability.expiresAtSeconds !== storedExpiry || storedExpiry <= nowSeconds) throw new HttpNotFoundError();
    return charge;
  }
}
