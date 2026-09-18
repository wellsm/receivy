import { HttpNotFoundError } from '@ez4/gateway';
import { type BillingDetail, type BillingGuestAction, BillingState } from '@receivy/common';
import { ensure, linkGuest } from '../../contacts/services/contact';
import type { DbClient } from '../../database';
import { joinSplit } from '../../invites/services/invite';
import type { InviteLinkContext } from '../../invites/services/links';
import { announceCharges, type NoticeContext } from '../../notifications/services/send';
import { AccountRepository } from '../../users/repositories/account';
import { BillingInactiveError, GuestAlreadyResolvedError } from '../errors';
import { BillingGuestRepository } from '../repositories/guest';
import { BillingGuestState } from '../schemas/billing-guest';
import { getBilling, loadBilling } from './detail';
import { auditBilling } from './split';

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
    await AccountRepository.lock(tx, ownerId);

    const guest = await BillingGuestRepository.get(tx, ownerId, billingId, guestId, true);

    if (!guest) {
      throw new HttpNotFoundError();
    }

    if (guest.state !== BillingGuestState.Pending) {
      throw new GuestAlreadyResolvedError();
    }

    const billing = await loadBilling(tx, ownerId, billingId, true);

    if (billing.state !== BillingState.Active) {
      throw new BillingInactiveError();
    }

    const instant = now.toISOString();

    if (action.action === 'link') {
      await linkGuest(tx, ownerId, action.contactId, guest.user_id, instant);
    } else if (action.action === 'add') {
      await ensure(tx, ownerId, guest.user_id, instant);
      await joinSplit(tx, billing, guest.user_id, instant, noticeChargeIds);
    }

    const state = action.action === 'link' ? BillingGuestState.Linked : action.action === 'add' ? BillingGuestState.Added : BillingGuestState.Dismissed;

    await BillingGuestRepository.resolve(tx, guest.id, state, instant);
    await auditBilling(tx, ownerId, billingId, `billings.guest_${state}`, instant, {
      userId: guest.user_id,
      ...(action.action === 'link' ? { contactId: action.contactId } : {})
    });
  });

  if (notice) {
    await announceCharges(db, notice, noticeChargeIds, now.getTime());
  }

  return getBilling(db, ownerId, billingId, now, link);
}
