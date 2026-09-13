import { HttpNotFoundError } from '@ez4/gateway';
import { type BillingDetail, type BillingGuestAction, BillingState } from '@receivy/common';
import { lockOwner } from '../../charges/services/materialize';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { InviteRepository } from '../../invites/repositories/invite';
import type { InviteLinkContext } from '../../invites/services/links';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { BillingInactiveError, GuestAlreadyResolvedError } from '../errors';
import { BillingRepository } from '../repositories/billing';
import { BillingGuestState } from '../schemas/billing-guest';

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

    if (guest.state !== BillingGuestState.Pending) {
      throw new GuestAlreadyResolvedError();
    }

    const billing = await tx.billings.findOne({
      select: BillingRepository.SELECT,
      where: { id: billingId, owner_id: ownerId },
      lock: true
    });

    if (!billing) {
      throw new HttpNotFoundError();
    }

    if (billing.state !== BillingState.Active) {
      throw new BillingInactiveError();
    }

    const instant = now.toISOString();

    if (action.action === 'link') {
      await ContactRepository.linkGuest(tx, ownerId, action.contactId, guest.user_id, instant);
    } else if (action.action === 'add') {
      await ContactRepository.ensure(tx, ownerId, guest.user_id, instant);
      await InviteRepository.joinSplit(tx, billing, guest.user_id, instant, noticeChargeIds);
    }

    const state =
      action.action === 'link' ? BillingGuestState.Linked : action.action === 'add' ? BillingGuestState.Added : BillingGuestState.Dismissed;

    await tx.billing_guests.updateOne({ where: { id: guest.id }, data: { state, resolved_at: instant } });
    await BillingRepository.audit(tx, ownerId, billingId, `billings.guest_${state}`, instant, {
      userId: guest.user_id,
      ...(action.action === 'link' ? { contactId: action.contactId } : {})
    });
  });

  if (notice) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  return BillingRepository.get(db, ownerId, billingId, now, link);
}
