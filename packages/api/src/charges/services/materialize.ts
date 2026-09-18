import { HttpNotFoundError } from '@ez4/gateway';
import { type BillingKind, type BillingPlan, type BillingRecurrence, ChargePayer, calendarDate, UserStatus } from '@receivy/common';
import { AllocationRepository } from '../../billings/repositories/allocation';
import { billingRegistered } from '../../billings/utils/columns';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { DbClient } from '../../database';
import { type MethodSnapshot, PaymentMethodRepository } from '../../payment-methods/repositories/payment-method';
import { AccountRepository } from '../../users/repositories/account';
import { ChargeRepository } from '../repositories/charge';
import { counterpartId } from '../utils/columns';
import { markRegistered } from './charge';

/** A participant validated against the owner's agenda: the person's account id, and whether they already use the app. */
export type ChargeRecipientMaterialization = { userId: string; active: boolean };

export type ChargeMaterializationContext = {
  recipients: Map<string, ChargeRecipientMaterialization>;
  payment: MethodSnapshot | null;
  /** 'owner' materializes a conta a pagar: the owner pays, the (optional) payee is the counterpart. */
  payer: ChargePayer;
};

/** How a conta a pagar materializes: the owner pays, the receiving contact's default key is the Pix. */
export type PayableMaterialization = {
  payer: ChargePayer.Owner;
  /** The receiving contact; absent when the bill is the owner's alone (no Pix on the charge). */
  contactId?: string;
};

/** What the persistence seam knows about the billing behind the plan: enough to settle a registro without reading it. */
export type ChargeBillingRef = { id: string; type: BillingRecurrence; kind: BillingKind; timezone: string };

/** The owner may only bill people in their agenda: every participant needs an unarchived contact and a live account. */
async function recipientSnapshots(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, ChargeRecipientMaterialization>> {
  const result = new Map<string, ChargeRecipientMaterialization>();

  for (const userId of new Set(userIds)) {
    const contact = await ContactRepository.byUser(db, ownerId, userId, true);
    const user = contact && !contact.archivedAt ? await AccountRepository.person(db, userId) : null;

    if (!user || user.status === UserStatus.Removed) {
      throw new HttpNotFoundError('Contato indisponível.');
    }

    result.set(userId, { userId, active: user.status === UserStatus.Active });
  }

  return result;
}

/** An explicit method wins; otherwise the default of the scope: the contact's keys, or the owner's own. */
export async function paymentSnapshot(
  db: DbClient,
  ownerId: string,
  paymentMethodId?: string,
  contactId?: string
): Promise<MethodSnapshot | null> {
  if (!paymentMethodId) {
    return PaymentMethodRepository.defaultOf(db, ownerId, contactId);
  }

  // A conta a receber publishes the owner's own key, never one they keep about a contact. A conta a
  // pagar takes any key of the owner: new pointers are checked when they are filed, and the legacy
  // ones the backfill leaves out of scope on purpose must keep paying.
  const key = await PaymentMethodRepository.pointer(db, ownerId, paymentMethodId, !contactId, true);

  if (!key || key.archivedAt) {
    throw new HttpNotFoundError('Meio de pagamento indisponível.');
  }

  return { provider: key.provider, kind: key.kind, value: key.value, label: key.label };
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
    // A conta a pagar without a contact is the owner's alone: no key, no notice.
    const payment = payable.contactId ? await paymentSnapshot(db, ownerId, paymentMethodId, payable.contactId) : null;

    return { recipients, payment, payer: ChargePayer.Owner };
  }

  return { recipients, payment: await paymentSnapshot(db, ownerId, paymentMethodId), payer: ChargePayer.Person };
}

/** How the billing behind new charges settles: a registro pays each charge due by today, in its own timezone. */
function settlementOf(billing: ChargeBillingRef, now: string): { settled: boolean; timezone: string; today: string } {
  return { settled: billingRegistered(billing), timezone: billing.timezone, today: calendarDate(new Date(now), billing.timezone) };
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
  const quiet = await AllocationRepository.quietParticipants(db, billing.id, ownerId);
  const settlement = settlementOf(billing, now);

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
    const inserted = await ChargeRepository.insert(db, {
      ownerId,
      creditorId: ownerPays ? recipient?.userId : ownerId,
      debtorId: ownerPays ? ownerId : recipient?.userId,
      billingId: billing.id,
      description: item.description,
      amountCents: item.amountCents,
      dueDate: item.dueDate,
      ...(item.installment !== null && item.installmentCount !== null ? { installment: item.installment, installmentCount: item.installmentCount } : {}),
      // A registro is never paid through a link, so the wallet key stays out of it.
      payment:
        context.payment && !settlement.settled
          ? { provider: context.payment.provider, ...(context.payment.kind ? { kind: context.payment.kind } : {}), value: context.payment.value, label: context.payment.label }
          : null,
      notify: !recipient || !quiet.has(recipient.userId),
      now
    });

    await EventRepository.record(db, {
      type: 'charge.created',
      eventableType: EventableType.Charge,
      eventableId: inserted.id,
      actorId: ownerId,
      // The payload keeps its key: it is history already written. The value is the person on the other side.
      payload: { billingId: inserted.billing_id, ...(counterpartId(inserted) ? { debtorUserId: counterpartId(inserted) } : {}) },
      at: now
    });

    // A registro is paid on its due date: whatever is already due settles in the same transaction.
    const due = settlement.settled && item.dueDate <= settlement.today;
    const row = due ? await markRegistered(db, inserted, settlement.timezone, now) : inserted;

    rows.push(row);
    noticeChargeIds.push(row.id);
  }

  return { rows, noticeChargeIds };
}
