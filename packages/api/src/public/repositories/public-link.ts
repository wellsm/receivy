import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { ChargeState, Direction, type PublicChargeView, type PublicLink } from '@receivy/common';
import { ChargeClosedError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { PaymentMethodKind, StoredProofState } from '../../charges/schemas/charge';
import { currentProof } from '../../proofs/repositories/proof-row';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { announceCharges, type NoticeContext, NoticeTemplate } from '../../notifications/services/send';
import { PixRequiredError, PixSnapshotLockedError } from '../errors';
import { type LinkRow, LinkRepository } from './link';
import { LinkableType } from '../schemas/link';
import { assertPublicLinkSecretConfigured, PublicTokenPurpose, verifyPublicChargeToken } from '../services/capability';
import { ensurePublicLink, linkToken } from '../services/links';

function response(link: LinkRow, secret: string): PublicLink {
  return { token: linkToken(link, secret), expiresAt: link.expires_at };
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
      if (direction !== Direction.Receivable || ChargeRepository.ownerPays(row)) throw new HttpForbiddenError();
      if (row.state !== ChargeState.Pending) throw new ChargeClosedError();

      let current = row;
      let published = false;
      // A charge published once without a key stays refused even after that link was revoked.
      const everPublished = await LinkRepository.everIssued(tx, LinkableType.Charge, row.id);

      if (!ChargeRepository.paymentOf(row)) {
        if (everPublished || !paymentMethodId) throw new PixRequiredError();
        const method = await tx.payment_methods.findOne({
          select: { pix_key: true, pix_key_type: true, label: true },
          // Only a conta a receber reaches this far (a conta a pagar is refused above), so the billing
          // has no contact: the key published here is the owner's own, never one kept about a contact.
          where: { id: paymentMethodId, owner_id: creditorId, contact_id: { isNull: true }, archived_at: { isNull: true } },
          lock: true
        });
        if (!method) throw new HttpNotFoundError();
        const stamp = new Date(nowSeconds * 1000).toISOString();
        await tx.charges.updateOne({
          where: { id: row.id },
          data: {
            payment_snapshot: {
              method: PaymentMethodKind.Pix,
              type: method.pix_key_type,
              value: method.pix_key,
              label: method.label ?? 'Pix'
            },
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
          where: { id: paymentMethodId, owner_id: creditorId, contact_id: { isNull: true }, archived_at: { isNull: true } }
        });
        if (!method) throw new HttpNotFoundError();
        const published = ChargeRepository.paymentOf(row);
        if (method.pix_key !== published?.value || method.pix_key_type !== published?.type) throw new PixSnapshotLockedError();
      }

      const linked = await ensurePublicLink(tx, current.id, nowSeconds, rotate);

      return { link: response(linked, secret), announce: published };
    });

    if (announce && notice) {
      await announceCharges(db, notice, [chargeId], nowSeconds * 1000);
    }

    return link;
  }

  export async function revoke(db: DbClient, creditorId: string, chargeId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const { row, direction } = await ChargeRepository.findForActor(tx, creditorId, chargeId, true);
      if (direction !== Direction.Receivable || ChargeRepository.ownerPays(row)) throw new HttpForbiddenError();
      if (!(await LinkRepository.live(tx, LinkableType.Charge, row.id))) return;
      const stamp = new Date().toISOString();
      await LinkRepository.revokeLive(tx, LinkableType.Charge, row.id, stamp);
      await tx.charges.updateOne({ where: { id: row.id }, data: { updated_at: stamp } });
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
    const creditorId = ChargeRepository.creditorOf(charge);
    const user = creditorId ? await db.users.findOne({ select: { name: true }, where: { id: creditorId } }) : undefined;
    const firstName = user?.name?.trim().split(/\s+/)[0] || 'Pessoa';
    const payment = ChargeRepository.paymentOf(charge);

    return {
      creditorFirstName: firstName,
      description: charge.description,
      amount: { amountCents: charge.amount_cents, currency: 'BRL' },
      dueDate: charge.due_date,
      state: charge.state,
      pix: payment ? { keyType: payment.type, key: payment.value, label: payment.label } : null,
      uploadsEnabled: charge.state === ChargeState.Pending && (await currentProof(db, charge.id))?.state !== StoredProofState.Pending
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
    const link = await LinkRepository.byPublicId(db, publicId);
    if (!link || link.linkable_type !== LinkableType.Charge || link.revoked_at) throw new HttpNotFoundError();
    let capability: { publicId: string; expiresAtSeconds: number };
    try {
      capability = verifyPublicChargeToken(token, { nowSeconds, secret, purpose: PublicTokenPurpose.Charge });
    } catch {
      throw new HttpNotFoundError();
    }
    const storedExpiry = Math.floor(Date.parse(link.expires_at) / 1000);
    if (capability.expiresAtSeconds !== storedExpiry || storedExpiry <= nowSeconds) throw new HttpNotFoundError();
    const charge = await db.charges.findOne({ select: ChargeRepository.SELECT, where: { id: link.linkable_id } });
    if (!charge) throw new HttpNotFoundError();
    return charge;
  }
}
