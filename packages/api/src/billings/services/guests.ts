import { HttpNotFoundError } from '@ez4/gateway';
import type { BillingDetail, BillingGuestAction } from '@receivy/common';
import { lockOwner } from '../../charges/services/materialize';
import { ensureContact, linkGuestToContact } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { joinSplit } from '../../invites/repositories/invite';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { BillingInactiveError, GuestAlreadyResolvedError } from '../errors';
import { audit, BILLING_SELECT, getBilling, type InviteLinkContext } from '../repositories/billing';

const GUEST_SELECT = { id: true, billing_id: true, owner_id: true, user_id: true, state: true, created_at: true } as const;

/**
 * The owner answers a waiting guest: they are one of the e-mail-less contacts (`link`), a new participant
 * (`add`) or nobody the billing needs (`dismiss`). Linking moves the placeholder's charges to the guest's
 * account; adding joins the split like an immediate acceptance would have.
 */
export async function resolveGuest(
  db: DbClient,
  ownerId: string,
  billingId: string,
  guestId: string,
  action: BillingGuestAction,
  now = new Date(),
  link?: InviteLinkContext,
  notice?: NoticeContext
): Promise<BillingDetail> {
  const noticeChargeIds: string[] = [];

  await db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const guest = await tx.billing_guests.findOne({
      select: GUEST_SELECT,
      where: { id: guestId, billing_id: billingId, owner_id: ownerId },
      lock: true
    });

    if (!guest) {
      throw new HttpNotFoundError();
    }

    if (guest.state !== 'pending') {
      throw new GuestAlreadyResolvedError();
    }

    const billing = await tx.billings.findOne({ select: BILLING_SELECT, where: { id: billingId, owner_id: ownerId }, lock: true });

    if (!billing) {
      throw new HttpNotFoundError();
    }

    if (billing.state !== 'active') {
      throw new BillingInactiveError();
    }

    const instant = now.toISOString();

    if (action.action === 'link') {
      await linkGuestToContact(tx, ownerId, action.contactId, guest.user_id, instant);
    } else if (action.action === 'add') {
      await ensureContact(tx, ownerId, guest.user_id, instant);
      await joinSplit(tx, billing, guest.user_id, instant, noticeChargeIds);
    }

    const state = action.action === 'link' ? 'linked' : action.action === 'add' ? 'added' : 'dismissed';

    await tx.billing_guests.updateOne({ where: { id: guest.id }, data: { state, resolved_at: instant } });
    await audit(tx, ownerId, billingId, `billings.guest_${state}`, instant, {
      userId: guest.user_id,
      ...(action.action === 'link' ? { contactId: action.contactId } : {})
    });
  });

  if (notice) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  return getBilling(db, ownerId, billingId, now, link);
}
