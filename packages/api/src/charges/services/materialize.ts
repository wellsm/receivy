import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import { type BillingPlan, type BillingType, ChargePayer, ChargeState, type PaymentMethod, UserStatus } from '@receivy/common';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { lockAccountReferences } from '../../users/services/locking';
import { ChargeRepository } from '../repositories/charge';

/** A participant validated against the owner's agenda: the person's account id, and whether they already use the app. */
export type ChargeRecipientMaterialization = { userId: string; active: boolean };

export type ChargeMaterializationContext = {
  recipients: Map<string, ChargeRecipientMaterialization>;
  pix: { keyType: PaymentMethod['pixKeyType']; key: string; label: string } | null;
  /** 'owner' materializes a conta a pagar: the owner pays, the (optional) payee is the counterpart. */
  payer: ChargePayer;
};

/** How a conta a pagar materializes: the key typed on the billing replaces any wallet lookup. */
export type PayableMaterialization = {
  payer: ChargePayer.Owner;
  pix?: { keyType: PaymentMethod['pixKeyType']; key: string; label?: string } | null;
};

export type ChargeBillingRef = { id: string; type: BillingType };

/** All billing mutations share this lock order: owner → billing → people → Pix. */
export async function lockOwner(db: DbClient, ownerId: string): Promise<void> {
  await lockAccountReferences(db, 'write');

  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });

  if (!owner) {
    throw new HttpUnauthorizedError();
  }
}

/** The owner may only bill people in their agenda: every participant needs an unarchived contact and a live account. */
async function recipientSnapshots(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, ChargeRecipientMaterialization>> {
  const result = new Map<string, ChargeRecipientMaterialization>();

  for (const userId of new Set(userIds)) {
    const contact = await db.contacts.findOne({
      select: { id: true, archived_at: true },
      where: { owner_id: ownerId, user_id: userId },
      lock: true
    });
    const user =
      contact && !contact.archived_at ? await db.users.findOne({ select: { id: true, status: true }, where: { id: userId } }) : undefined;

    if (!user || user.status === UserStatus.Removed) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    result.set(userId, { userId, active: user.status === UserStatus.Active });
  }

  return result;
}

async function pixSnapshot(db: DbClient, ownerId: string, paymentMethodId?: string): Promise<ChargeMaterializationContext['pix']> {
  if (paymentMethodId) {
    const row = await db.payment_methods.findOne({
      select: { pix_key_type: true, pix_key: true, label: true, archived_at: true },
      where: { id: paymentMethodId, owner_id: ownerId },
      lock: true
    });

    if (!row || row.archived_at) {
      throw new HttpNotFoundError('Chave Pix indisponível.');
    }

    return { keyType: row.pix_key_type, key: row.pix_key, label: row.label };
  }

  const { records } = await db.payment_methods.findMany({
    select: { pix_key_type: true, pix_key: true, label: true },
    where: { owner_id: ownerId, is_default: true, archived_at: { isNull: true } },
    take: 1
  });

  const row = records[0];

  return row ? { keyType: row.pix_key_type, key: row.pix_key, label: row.label } : null;
}

/** Validates owner-scoped people/payment method and captures values before materialization. */
export async function prepareChargeMaterialization(
  db: DbClient,
  ownerId: string,
  userIds: string[],
  paymentMethodId?: string,
  payable?: PayableMaterialization
): Promise<ChargeMaterializationContext> {
  const recipients = await recipientSnapshots(db, ownerId, userIds);

  if (payable) {
    const pix = payable.pix ? { keyType: payable.pix.keyType, key: payable.pix.key, label: payable.pix.label ?? 'Pix' } : null;

    return { recipients, pix, payer: ChargePayer.Owner };
  }

  return { recipients, pix: await pixSnapshot(db, ownerId, paymentMethodId), payer: ChargePayer.Person };
}

async function recordCreation(db: DbClient, ownerId: string, row: ChargeRepository.Row, now: string): Promise<void> {
  await EventRepository.record(db, {
    type: 'charge.created',
    eventableType: EventableType.Charge,
    eventableId: row.id,
    actorId: ownerId,
    payload: { billingId: row.billing_id, ...(row.debtor_user_id ? { debtorUserId: row.debtor_user_id } : {}) },
    at: now
  });
}

/**
 * Shared persistence seam for every billing type. Caller owns the transaction and, once it
 * commits, hands `noticeChargeIds` to `announceCharges` so the people involved hear about them.
 */
export async function persistChargePlan(
  db: DbClient,
  ownerId: string,
  plan: BillingPlan,
  billing: ChargeBillingRef,
  context: ChargeMaterializationContext,
  now: string
): Promise<{ rows: ChargeRepository.Row[]; noticeChargeIds: string[] }> {
  const rows: ChargeRepository.Row[] = [];
  const noticeChargeIds: string[] = [];

  for (const item of plan.charges) {
    // A conta a pagar without a payee has no one on the other side: the owner is both parties.
    const recipient = item.userId ? context.recipients.get(item.userId) : undefined;

    if (item.userId && !recipient) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    if (!item.userId && context.payer !== ChargePayer.Owner) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    const row = await db.charges.insertOne({
      select: ChargeRepository.SELECT,
      data: {
        id: crypto.randomUUID(),
        creditor: { id: ownerId },
        ...(recipient ? { debtor_user: { id: recipient.userId } } : {}),
        payer: context.payer,
        billing: { id: billing.id },
        billing_type: billing.type,
        description: item.description,
        amount_cents: item.amountCents,
        currency: item.currency,
        due_date: item.dueDate,
        ...(item.installment !== null && item.installmentCount !== null
          ? { installment: item.installment, installment_count: item.installmentCount }
          : {}),
        ...(context.pix
          ? { pix_key_type_snapshot: context.pix.keyType, pix_key_snapshot: context.pix.key, pix_label_snapshot: context.pix.label }
          : {}),
        state: ChargeState.Pending,
        created_at: now,
        updated_at: now
      }
    });

    rows.push(row);
    noticeChargeIds.push(row.id);

    await recordCreation(db, ownerId, row, now);
  }

  return { rows, noticeChargeIds };
}
