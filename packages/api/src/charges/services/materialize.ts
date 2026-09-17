import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import {
  type BillingPlan,
  type BillingRecurrence,
  ChargePayer,
  ChargeState,
  calendarDate,
  type PaymentMethod,
  UserStatus
} from '@receivy/common';
import { billingRegistered } from '../../billings/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { lockAccountReferences } from '../../users/services/locking';
import { ChargeRepository } from '../repositories/charge';
import { PaymentMethodKind } from '../schemas/charge';

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

export type ChargeBillingRef = { id: string; type: BillingRecurrence };

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

/** Participants whose allocation says "Não notificar": every charge created for them starts with the notices off. */
async function quietDebtors(db: DbClient, billingId: string, ownerId: string): Promise<Set<string>> {
  const { records } = await db.allocations.findMany({
    select: { user_id: true },
    where: { billing_id: billingId, user_id: { not: ownerId }, notify: false }
  });
  const quiet = new Set<string>();

  for (const row of records) {
    if (row.user_id) {
      quiet.add(row.user_id);
    }
  }

  return quiet;
}

/** How the billing behind new charges settles: a registro pays each charge due by today, in its own timezone. */
async function settlementOf(db: DbClient, billingId: string, now: string): Promise<{ settled: boolean; timezone: string; today: string }> {
  const row = await db.billings.findOne({ select: { kind: true, owner_id: true }, where: { id: billingId } });

  if (!row) {
    throw new HttpNotFoundError();
  }

  const owner = await db.users.findOne({ select: { timezone: true }, where: { id: row.owner_id } });

  if (!owner) {
    throw new HttpNotFoundError();
  }

  return { settled: billingRegistered(row), timezone: owner.timezone, today: calendarDate(new Date(now), owner.timezone) };
}

async function recordCreation(db: DbClient, ownerId: string, row: ChargeRepository.Row, now: string): Promise<void> {
  await EventRepository.record(db, {
    type: 'charge.created',
    eventableType: EventableType.Charge,
    eventableId: row.id,
    actorId: ownerId,
    // The payload keeps its key: it is history already written. The value is the person on the other side.
    payload: { billingId: row.billing_id, ...(ChargeRepository.counterpartId(row) ? { debtorUserId: ChargeRepository.counterpartId(row) } : {}) },
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

  // Creation, the monthly sweep, edits and invites all land here, after the allocations are saved.
  const quiet = await quietDebtors(db, billing.id, ownerId);
  const settlement = await settlementOf(db, billing.id, now);

  for (const item of plan.charges) {
    // A conta a pagar without a payee and a registro have no one on the other side.
    const recipient = item.userId ? context.recipients.get(item.userId) : undefined;

    if (item.userId && !recipient) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    if (!item.userId && context.payer !== ChargePayer.Owner && !settlement.settled) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    const ownerPays = context.payer === ChargePayer.Owner;
    // The money's own axis: whoever receives sits in creditor_id, whoever pays in debtor_id, the owner in owner_id.
    const creditorId = ownerPays ? recipient?.userId : ownerId;
    const debtorId = ownerPays ? ownerId : recipient?.userId;
    const inserted = await db.charges.insertOne({
      select: ChargeRepository.SELECT,
      data: {
        id: crypto.randomUUID(),
        owner: { id: ownerId },
        ...(creditorId ? { creditor: { id: creditorId } } : {}),
        ...(debtorId ? { debtor: { id: debtorId } } : {}),
        billing: { id: billing.id },
        description: item.description,
        amount_cents: item.amountCents,
        due_date: item.dueDate,
        ...(item.installment !== null && item.installmentCount !== null
          ? { installment: item.installment, installment_count: item.installmentCount }
          : {}),
        // A registro is never paid through a link, so the wallet key stays out of it.
        ...(context.pix && !settlement.settled
          ? {
              payment_snapshot: {
                method: PaymentMethodKind.Pix,
                type: context.pix.keyType,
                value: context.pix.key,
                label: context.pix.label
              }
            }
          : {}),
        state: ChargeState.Pending,
        notify: !recipient || !quiet.has(recipient.userId),
        created_at: now,
        updated_at: now
      }
    });

    await recordCreation(db, ownerId, inserted, now);

    // A registro is paid on its due date: whatever is already due settles in the same transaction.
    const due = settlement.settled && item.dueDate <= settlement.today;
    const row = due ? await ChargeRepository.markRegistered(db, inserted, settlement.timezone, now) : inserted;

    rows.push(row);
    noticeChargeIds.push(row.id);
  }

  return { rows, noticeChargeIds };
}
