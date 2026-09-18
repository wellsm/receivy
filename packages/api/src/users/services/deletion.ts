import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import { AllocationRepository } from '../../billings/repositories/allocation';
import { BillingRepository } from '../../billings/repositories/billing';
import { BillingGuestRepository } from '../../billings/repositories/guest';
import { ChargeRepository } from '../../charges/repositories/charge';
import { creditorOf } from '../../charges/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { DeviceRepository } from '../../notifications/repositories/device';
import { PaymentMethodRepository } from '../../payment-methods/repositories/payment-method';
import { ProofRepository } from '../../proofs/repositories/proof';
import { LinkRepository } from '../../public/repositories/link';
import { LinkableType } from '../../public/schemas/link';
import { AccountRepository } from '../repositories/account';
import { AuthRepository } from '../repositories/auth';
import { SessionRepository } from '../repositories/sessions';
import { avatarKey, avatarStagingKey } from '../utils/avatar';

/** A charge the erased person was on: their side of it goes, the other side keeps reading it. */
async function eraseFromCharge(tx: DbClient, userId: string, chargeId: string, now: string, objectKeys: string[]): Promise<void> {
  const charge = await ChargeRepository.get(tx, chargeId, true);

  if (!charge) {
    return;
  }

  // Whoever receives holds the key the charge is paid with: with them gone, the link and the snapshot go too.
  const creditorDeleted = creditorOf(charge) === userId;

  // The public link of a charge whose creditor is gone must stop opening.
  if (creditorDeleted) {
    await LinkRepository.revokeLive(tx, LinkableType.Charge, chargeId, now);
  }

  const proof = await ProofRepository.current(tx, chargeId, true);
  const senderDeleted = proof?.sender_user_id === userId;

  // A file the erased person sent goes with them; the charge itself stays for the other side to read.
  if (senderDeleted && proof?.file) {
    objectKeys.push(proof.file.key);
  }

  if (senderDeleted) {
    await ProofRepository.removeByCharge(tx, chargeId);
  }

  if (creditorDeleted) {
    await ChargeRepository.clearPayment(tx, chargeId, now);
  } else {
    await ChargeRepository.touch(tx, chargeId, now);
  }
}

export async function eraseAccount(db: DbClient, userId: string, confirmation: string): Promise<{ deleted: boolean; objectKeys: string[] }> {
  if (confirmation !== 'EXCLUIR') {
    throw new HttpBadRequestError('Confirme digitando EXCLUIR.');
  }

  return db.transaction(async (tx) => {
    // Built inside the transaction so a retried erasure never reports files twice.
    const objectKeys: string[] = [];
    const user = await AccountRepository.forErasure(tx, userId);

    if (!user) {
      throw new HttpUnauthorizedError();
    }

    if (user.deleted_at) {
      return { deleted: true, objectKeys };
    }

    objectKeys.push(avatarKey(userId));
    objectKeys.push(avatarStagingKey(userId));

    const now = new Date().toISOString();

    await SessionRepository.revokeAllOf(tx, userId, now);
    await SessionRepository.removeRefreshTokensOf(tx, await SessionRepository.familyIdsOf(tx, userId));

    // Stop future generation before touching historical records. Existing amounts/state stay unchanged.
    const billingIds = await BillingRepository.idsOwnedBy(tx, userId, true);

    // No surviving link may still add participants to an erased owner's billings. A link points at the
    // billing, not at the owner, so the billings just read above are the way in.
    for (const billingId of billingIds) {
      await LinkRepository.revokeLive(tx, LinkableType.BillingInvite, billingId, now);
    }

    for (const billingId of billingIds) {
      await BillingRepository.markErased(tx, billingId, now);
    }

    // Whoever sent a proof is reached through the proofs table now, so their charges come in by id.
    const proofChargeIds = await ProofRepository.chargeIdsSentBy(tx, userId);
    const chargeIds = await ChargeRepository.idsTouching(tx, userId, proofChargeIds, true);

    await DeviceRepository.disableOf(tx, userId, undefined, now);

    for (const chargeId of chargeIds) {
      await eraseFromCharge(tx, userId, chargeId, now, objectKeys);
    }

    // The agenda of the erased account goes; every agenda that listed it keeps an archived entry so history still reads.
    await BillingGuestRepository.removeOf(tx, userId);
    await ContactRepository.removeAgenda(tx, userId);
    await ContactRepository.archiveMentions(tx, userId, now);

    for (const billingId of billingIds) {
      if (!(await ChargeRepository.hasAny(tx, billingId))) {
        await LinkRepository.removeFor(tx, LinkableType.BillingInvite, billingId);
        await AllocationRepository.removeOf(tx, billingId);
        await BillingRepository.remove(tx, billingId);
      }
    }

    await PaymentMethodRepository.removeOf(tx, userId);
    await AuthRepository.removeIdentities(tx, userId);
    await AuthRepository.removeGrants(tx, userId);

    if (user.email) {
      await AuthRepository.removeLoginCodes(tx, user.email);
    }

    // The log keeps its lines but forgets who acted; the account's own history goes with it.
    await EventRepository.removeOf(tx, EventableType.Account, userId);
    await EventRepository.forgetActor(tx, userId);
    await AccountRepository.erase(tx, userId, now);
    await EventRepository.record(tx, { type: 'account.deleted', eventableType: EventableType.Account, eventableId: userId, at: now });

    // The caller sends these only after this transaction commits.
    return { deleted: true, objectKeys };
  });
}
